import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { getDatabase, ref, set, onValue, remove, get } from "firebase/database";
// import UserChatBox from "./userChatBox";

const AudioComponent = ({ isAudioOn }) => {
  const [audioStream, setAudioStream] = useState(null);

  useEffect(() => {
    let stream;
    const getAudio = async () => {
      try {
        if (isAudioOn) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setAudioStream(stream);
        } else if (audioStream) {
          audioStream.getTracks().forEach((track) => track.stop());
          setAudioStream(null);
        }
      } catch (err) {
        console.error("Error accessing audio:", err);
      }
    };

    getAudio();

    return () => {
      if (audioStream) {
        audioStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isAudioOn, audioStream]);
};

const JoinMeetPage = ({
  translateJoinPage,
  isLoggedIn,
  userNameData,
  handleNavDisp,
  onSuccess,
  onError,
}) => {
  const db = getDatabase();
  const [users, setUsers] = useState([]);

  const [chatBoxDisp, setChatBoxDisp] = useState("none");
  const [chatBoxTranslate, setChatBoxTranslate] = useState("translateX(400px)");
  const [participantsDisp, setParticipantsDisp] = useState("none");
  const [participantsTranslate, setParticipantsTranslate] = useState("translateX(400px)");
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isAudioOn, setIsAudioOn] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [socket, setSocket] = useState(null);
  const [userMediaState, setUserMediaState] = useState({});
  const [joinedRoomId, setJoinedRoomId] = useState(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const [remoteStreams, setRemoteStreams] = useState({}); 
  const remoteStreamsRef = useRef({});
  const iceServersRef = useRef([]);
  const [iceServersReady, setIceServersReady] = useState(false);
  const sendersRef = useRef({});

  const getRtcConfig = () => ({
    bundlePolicy: 'max-bundle',
    iceCandidatePoolSize: 0,
    iceServers: iceServersRef.current,
  });
  
  const pathname = window.location.pathname;
  const segments = pathname.split("/");
  const dynamicRoute = segments[2];
  const usersRef = useMemo(
    () => ref(db, `rooms/${dynamicRoute}`),
    [db, dynamicRoute]
  );
  const navigate = useNavigate();
  const [isClicked, setIsClicked] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(joinedRoomId);
    setIsClicked(true);
    alert("Room ID copied successfully!");
    setTimeout(() => setIsClicked(false), 200); 
  };

  useEffect(() => {
  }, [isLoggedIn]);

 
  useEffect(() => {
    const fetchTurnCredentials = async () => {
      try {
        const serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;
        // console.log("[WebRTC] Fetching TURN credentials from:", `${serverUrl}/api/turn-credentials`);
        const response = await fetch(`${serverUrl}/api/turn-credentials`);
        if (response.ok) {
          const credentials = await response.json();
          if (Array.isArray(credentials) && credentials.length > 0) {
            iceServersRef.current = credentials;
            // console.log("[WebRTC] TURN credentials loaded:", credentials.length, "servers");
          } else {
            console.warn("[WebRTC] Server returned empty credentials, using fallback STUN");
            iceServersRef.current = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
          }
        } else {
          console.warn("[WebRTC] TURN endpoint returned:", response.status, "— using fallback STUN");
          iceServersRef.current = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
        }
      } catch (error) {
        console.warn("[WebRTC] Failed to fetch TURN credentials, using fallback STUN:", error.message);
        iceServersRef.current = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
      }
      setIceServersReady(true);
    };
    fetchTurnCredentials();
  }, []);

 

  const toggleVideo = (socketId) => {
    if (!socket || socketId !== socket.id) return;
    setUserMediaState((prevState) => ({
      ...prevState,
      [socketId]: {
        ...prevState[socketId],
        isCameraOn: !prevState[socketId]?.isCameraOn,
      },
    }));
    handleCameraToggle();
  };

  const toggleAudio = (socketId) => {
    if (!socket || socketId !== socket.id) return;
    setUserMediaState((prevState) => ({
      ...prevState,
      [socketId]: {
        ...prevState[socketId],
        isAudioOn: !prevState[socketId]?.isAudioOn,
      },
    }));
    handleAudioToggle();
  };

  const ensureLocalStreamContainer = () => {
    if (!localStreamRef.current) {
      localStreamRef.current = new MediaStream();
    }
    return localStreamRef.current;
  };

  const getExistingLocalTrack = (kind) => {
    const stream = localStreamRef.current;
    if (!stream) return undefined;
    if (kind === 'audio') return stream.getAudioTracks()[0];
    if (kind === 'video') return stream.getVideoTracks()[0];
    return undefined;
  };

  const acquireLocalTrack = async (kind) => {
    try {
      if (kind === 'audio') {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return s.getAudioTracks()[0];
      }
      if (kind === 'video') {
        const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        return s.getVideoTracks()[0];
      }
    } catch (err) {
      console.error(`Failed to get ${kind} track`, err);
      return undefined;
    }
  };

  const addOrReplaceTrackOnPeer = (peerId, track) => {
    const pc = peerConnectionsRef.current[peerId];
    if (!pc || !track) return;
    const kind = track.kind;
    if (!sendersRef.current[peerId]) sendersRef.current[peerId] = { audio: null, video: null };
    const existingManagedSender = sendersRef.current[peerId][kind];
    if (existingManagedSender) {
      existingManagedSender.replaceTrack(track).catch((e) => console.warn('replaceTrack failed', e));
      return;
    }
  
    const fallbackSender = pc.getSenders().find((s) => s.track && s.track.kind === kind);
    if (fallbackSender) {
      fallbackSender.replaceTrack(track).catch((e) => console.warn('replaceTrack failed', e));
      sendersRef.current[peerId][kind] = fallbackSender;
      return;
    }
   
    const newSender = pc.addTrack(track, ensureLocalStreamContainer());
    sendersRef.current[peerId][kind] = newSender;
  };

  const addOrReplaceTrackOnAllPeers = (track) => {
    Object.keys(peerConnectionsRef.current).forEach((peerId) => addOrReplaceTrackOnPeer(peerId, track));
  };

  const removeTrackFromAllPeers = (kind) => {
    Object.entries(peerConnectionsRef.current).forEach(([peerId, pc]) => {
      const managedSender = sendersRef.current[peerId]?.[kind] || null;
      if (managedSender) {
        managedSender.replaceTrack(null).catch((e) => console.warn('replaceTrack(null) failed', e));
        return;
      }
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === kind);
      if (sender) sender.replaceTrack(null).catch((e) => console.warn('replaceTrack(null) failed', e));
    });
  };

  const renegotiateAllPeersAsOfferer = async () => {
    if (!socket) return;
    for (const [peerId, pc] of Object.entries(peerConnectionsRef.current)) {
      if (!pc) continue;
      try {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', { roomId: dynamicRoute, offer, from: socket.id, to: peerId });
      } catch (e) {
        console.warn('Offer on toggle failed for', peerId, e);
      }
    }
  };

  const handleCameraToggle = async () => {
    if (!isCameraOn) {
      const track = await acquireLocalTrack('video');
      if (track) {
        ensureLocalStreamContainer().addTrack(track);
        addOrReplaceTrackOnAllPeers(track);
      }
      setIsCameraOn(true);
      socket && socket.emit('media-state-changed', { roomId: dynamicRoute, isCameraOn: true, isAudioOn });
      await renegotiateAllPeersAsOfferer();
    } else {
      const track = getExistingLocalTrack('video');
      if (track) {
        track.stop();
        removeTrackFromAllPeers('video');
        ensureLocalStreamContainer().removeTrack(track);
      }
      setIsCameraOn(false);
      socket && socket.emit('media-state-changed', { roomId: dynamicRoute, isCameraOn: false, isAudioOn });
      await renegotiateAllPeersAsOfferer();
    }
  };

  const handleAudioToggle = async () => {
    if (!isAudioOn) {
      const track = await acquireLocalTrack('audio');
      if (track) {
        ensureLocalStreamContainer().addTrack(track);
        addOrReplaceTrackOnAllPeers(track);
      }
      setIsAudioOn(true);
      socket && socket.emit('media-state-changed', { roomId: dynamicRoute, isCameraOn, isAudioOn: true });
      await renegotiateAllPeersAsOfferer();
    } else {
      const track = getExistingLocalTrack('audio');
      if (track) {
        track.stop();
        removeTrackFromAllPeers('audio');
        ensureLocalStreamContainer().removeTrack(track);
      }
      setIsAudioOn(false);
      socket && socket.emit('media-state-changed', { roomId: dynamicRoute, isCameraOn, isAudioOn: false });
      await renegotiateAllPeersAsOfferer();
    }
  };


  const createPeerConnection = (peerId) => {
    if (peerConnectionsRef.current[peerId]) return peerConnectionsRef.current[peerId];
    const pc = new RTCPeerConnection(getRtcConfig());
    peerConnectionsRef.current[peerId] = pc;
    try {
      const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
      if (!sendersRef.current[peerId]) sendersRef.current[peerId] = { audio: null, video: null };
      sendersRef.current[peerId].audio = audioTransceiver.sender;
      sendersRef.current[peerId].video = videoTransceiver.sender;
    } catch (e) {
      console.warn('Failed to add transceivers', e);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc-candidate', { roomId: dynamicRoute, candidate: event.candidate, from: socket.id, to: peerId });
      }
    };

    pc.ontrack = (event) => {
      let peerStream = remoteStreamsRef.current[peerId];
      if (!peerStream) {
        peerStream = new MediaStream();
        remoteStreamsRef.current[peerId] = peerStream;
      }
      if (!peerStream.getTracks().some((t) => t.id === event.track.id)) {
        peerStream.addTrack(event.track);
        event.track.addEventListener('ended', () => {
          const currentStream = remoteStreamsRef.current[peerId];
          if (!currentStream) return;
          currentStream.getTracks().forEach((t) => {
            if (t.id === event.track.id) currentStream.removeTrack(t);
          });
          setRemoteStreams((prev) => ({ ...prev, [peerId]: currentStream }));
        });
      }
      setRemoteStreams((prev) => ({ ...prev, [peerId]: peerStream }));
    };
    const s = localStreamRef.current;
    if (s) {
      s.getTracks().forEach((t) => addOrReplaceTrackOnPeer(peerId, t));
    }

    return pc;
  };

  const initiateConnectionIfNeeded = async (peerId) => {
    if (!socket || peerId === socket.id) return;
    const pc = createPeerConnection(peerId);
    try {
      if (socket.id < peerId) {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', { roomId: dynamicRoute, offer, from: socket.id, to: peerId });
      }
    } catch (e) {
      console.error('Failed to create/send offer', e);
    }
  };

  const handleChatBoxDisplay = () => {
    // Close participants panel first if it's open
    if (participantsDisp === "flex") {
      setParticipantsTranslate("translateX(400px)");
      setTimeout(() => setParticipantsDisp("none"), 300);
    }
    setChatBoxDisp((prevDisp) => (prevDisp === "none" ? "flex" : "none"));
    setTimeout(() => {
      setChatBoxTranslate((prevTranslate) =>
        prevTranslate === "translateX(400px)"
          ? "translateX(0px)"
          : "translateX(400px)"
      );
    }, 50);
  };

  const handleParticipantsDisplay = () => {
    // Close chat panel first if it's open
    if (chatBoxDisp === "flex") {
      setChatBoxTranslate("translateX(400px)");
      setTimeout(() => setChatBoxDisp("none"), 300);
    }
    setParticipantsDisp((prevDisp) => (prevDisp === "none" ? "flex" : "none"));
    setTimeout(() => {
      setParticipantsTranslate((prevTranslate) =>
        prevTranslate === "translateX(400px)" ? "translateX(0px)" : "translateX(400px)"
      );
    }, 50);
    setJoinedRoomId(dynamicRoute);
  };

  const handleParticipantsClose = () => {
    setParticipantsTranslate("translateX(400px)");
    setTimeout(() => setParticipantsDisp("none"), 300);
  };

  const handleChatClose = () => {
    setChatBoxTranslate("translateX(400px)");
    setTimeout(() => setChatBoxDisp("none"), 300);
  };

  const handleInfoToggle = () => {
    setShowInfoModal((prev) => !prev);
  };

  const getMeetingLink = () => {
    const base = window.location.origin;
    return `${base}/meet?code=${dynamicRoute}`;
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(getMeetingLink());
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  useEffect(() => {
    if (!socket) {
      const playNotificationSound = (meetState) => {
        if (meetState === "join") {
          const audio = new Audio("/userMeetJoinSound.wav");
          audio.play().catch((err) => console.error("Audio play error:", err));
        }
        if (meetState === "leave") {
          const audio = new Audio("/userMeetLeaveSound.wav");
          audio.play().catch((err) => console.error("Audio play error:", err));
        }
      };
      const serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;
      const newSocket = io(serverUrl);
      // console.log("ye naya socket hai ", newSocket);
      setSocket(newSocket);

      newSocket.on("connect", async () => {
        // console.log("Connected to socket server");

        if (dynamicRoute === "new") {
          newSocket.emit("create-room", async (roomId) => {
            // console.log(userNameData);
            // console.log("Room created:", roomId);
            const roomRef = ref(db, `rooms/${roomId}`);
            await set(roomRef, {
              users: {
                [newSocket.id]: {
                  userName: userNameData,
                  isAudioOn: isAudioOn,
                  isCameraOn: isCameraOn,
                },
              },
            });
            newSocket.emit("user-connection-room", { userRoomId: roomId, userName: userNameData });
            navigate(`/joinMeetPage/${roomId}`);
            playNotificationSound("join");
            onSuccess("Room created successfully");
          });
        } else {
          const roomRef = ref(db, `rooms/${dynamicRoute}`);
          const snapshot = await get(roomRef);
          playNotificationSound("join");
          if (snapshot.exists()) {
            const userRef = ref(
              db,
              `rooms/${dynamicRoute}/users/${newSocket.id}`
            );
            await set(userRef, {
              userName: userNameData,
              isAudioOn: isAudioOn,
              isCameraOn: isCameraOn,
            });

            newSocket.emit(
              "user-connection-room",
              { userRoomId: dynamicRoute, userName: userNameData },
              () => {
                newSocket.on("user-has-connected", (currentUserName) => {
                  onSuccess(
                    `User ${currentUserName} successfully connected to room`
                  );
                });
              }
            );
          } else {
            onError("Room does not exist. Please check the Room ID.");
          }
        }
      });

      let hasUserJoinedMessageShown = false;
      newSocket.on("user-joined", (currentUserName) => {
        if (!hasUserJoinedMessageShown) {
          hasUserJoinedMessageShown = true;
          setTimeout(() => {
            playNotificationSound("join");
            onSuccess(`User ${currentUserName} joined`);
          }, 1000);
        }
      });
      newSocket.on('webrtc-offer', async ({ offer, from }) => {
        try {
          const pc = createPeerConnection(from);
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const s = localStreamRef.current;
          if (s) {
            s.getTracks().forEach((t) => addOrReplaceTrackOnPeer(from, t));
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          newSocket.emit('webrtc-answer', { roomId: dynamicRoute, answer, from: newSocket.id, to: from });
        } catch (e) {
          console.error('Error handling offer from', from, e);
        }
      });

      newSocket.on('webrtc-answer', async ({ answer, from }) => {
        const pc = peerConnectionsRef.current[from];
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (e) {
          console.error('Error setting remote answer from', from, e);
        }
      });

      newSocket.on('webrtc-candidate', async ({ candidate, from }) => {
        const pc = peerConnectionsRef.current[from];
        if (!pc) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('Error adding ICE candidate from', from, e);
        }
      });

      newSocket.on('media-state-changed', ({ socketId, isCameraOn, isAudioOn }) => {
        setUserMediaState((prev) => ({
          ...prev,
          [socketId]: { ...(prev[socketId] || {}), isCameraOn, isAudioOn },
        }));
      });

      newSocket.on("user-message-receive", ({ userMessage, roomUserName }) => {
        setChatBoxDisp((prevChatBoxDisp) => {
          if (prevChatBoxDisp !== "flex") {
            onSuccess(`New message from ${roomUserName}`);
            playNotificationSound();
          }
          return prevChatBoxDisp;
        });

        const playNotificationSound = () => {
          const audio = new Audio("/notificationSound.wav");
          audio.play().catch((err) => console.error("Audio play error:", err));
        };

        const userChatBox = document.querySelector(".user-chat-box-container");
        const userChatTimeContainer = document.createElement("div");
        userChatTimeContainer.classList.add("user-chat-time-container");

        const userMessageBox = document.createElement("div");
        userMessageBox.classList.add("user-message-box");
        userMessageBox.innerHTML = userMessage;

        const senderInfo = document.createElement("div");
        senderInfo.classList.add("user-sender-name-time-stamp");
        senderInfo.innerHTML = `${roomUserName} &nbsp;&nbsp; ${new Date().toLocaleTimeString(
          [],
          { hour: "2-digit", minute: "2-digit" }
        )}`;

        userChatTimeContainer.appendChild(userMessageBox);
        userChatTimeContainer.appendChild(senderInfo);

        userChatBox.appendChild(userChatTimeContainer);
      });

      newSocket.on("user-left", (leftSocketId) => {
        playNotificationSound("leave");
        onError(`User ${userNameData} left the room`);
        const pc = peerConnectionsRef.current[leftSocketId];
        if (pc) {
          try { pc.close(); } catch (err) { console.warn('pc close failed', err); }
          delete peerConnectionsRef.current[leftSocketId];
        }
        setRemoteStreams((prev) => {
          const copy = { ...prev };
          delete copy[leftSocketId];
          return copy;
        });
      });

      newSocket.on("user-connection", (clientCount) => {
        // console.log("User connected with ID:", clientCount / 2);
      });

      return () => {
        Object.values(peerConnectionsRef.current).forEach((pc) => {
          try { pc.close(); } catch (err) { console.warn('pc close failed', err); }
        });
        peerConnectionsRef.current = {};
        sendersRef.current = {};
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
          localStreamRef.current = null;
        }
        newSocket.disconnect();
        // console.log("Socket disconnected");
      };
    }
  }, []);

  const addMessageBox = () => {
    if (userInput.trim()) {
      socket.emit("user-message-send", {
        userRoomId: dynamicRoute,
        userMessage: userInput,
        roomUserName: userNameData,
        userMessageTime: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });

      const userChatBox = document.querySelector(".user-chat-box-container");
      const userChatTimeContainer = document.createElement("div");
      userChatTimeContainer.classList.add("user-chat-time-container");

      const userMessageBox = document.createElement("div");
      userMessageBox.classList.add("user-message-box");
      userMessageBox.innerHTML = userInput;

      const senderInfo = document.createElement("div");
      senderInfo.classList.add("user-sender-name-time-stamp");
      senderInfo.innerHTML = `${userNameData} &nbsp;&nbsp; ${new Date().toLocaleTimeString(
        [],
        { hour: "2-digit", minute: "2-digit" }
      )}`;

      userChatTimeContainer.appendChild(userMessageBox);
      userChatTimeContainer.appendChild(senderInfo);

      userChatBox.appendChild(userChatTimeContainer);

      setUserInput("");
    }
  };

  useEffect(() => {
    onValue(usersRef, (snapshot) => {
      const usersData = snapshot.val();
      // console.log("Fetched users data:", usersData);
      if (usersData && usersData.users) {
        setUsers(
          Object.entries(usersData.users).map(([socketId, userData]) => ({
            socketId,
            userName: userData.userName,
            isAudioOn: userData.isAudioOn,
            isCameraOn: userData.isCameraOn,
          }))
        );
        const peerIds = Object.keys(usersData.users);
        if (iceServersReady) {
          peerIds.forEach((peerId) => {
            if (socket && peerId !== socket.id && !peerConnectionsRef.current[peerId]) {
              initiateConnectionIfNeeded(peerId);
            }
          });
        }
        Object.keys(peerConnectionsRef.current).forEach((peerId) => {
          if (!peerIds.includes(peerId)) {
            const pc = peerConnectionsRef.current[peerId];
            if (pc) {
              try { pc.close(); } catch (err) { console.warn('pc close failed', err); }
            }
            delete peerConnectionsRef.current[peerId];
            setRemoteStreams((prev) => {
              const copy = { ...prev };
              delete copy[peerId];
              return copy;
            });
          }
        });
      } else {
        setUsers([]);
      }
    });
  }, [usersRef, iceServersReady]);

  const leaveMeeting = () => {
    const playNotificationSound = () => {
      const audio = new Audio("/userMeetLeaveSound.wav");
      audio.play().catch((err) => console.error("Audio play error:", err));
    };
    // console.log("dynamic leaving", dynamicRoute);
    // console.log("dynamic leaving socket", socket.id);
    const userRef = ref(db, `rooms/${dynamicRoute}/users/${socket.id}`);
    // console.log("User Reference: ", userRef);
    remove(userRef)
      .then(() => {
        socket.emit("leave-room", dynamicRoute);
        socket.on("user-left", (socketId) => {
          onError(`User ${userNameData} left the room wit id ${socketId}.`);
        });
        // console.log("User removed from database");
        navigate("/meet");
        handleNavDisp();
        playNotificationSound();
        onError(`User ${userNameData} left the room.`);
        socket.disconnect();
      })
      .catch((error) => {
        console.error("Error removing user: ", error);
      });
  };

  return (
    <div className="join-meet-page-wrapper">
      <div
        className="join-meet-page-video-chat-body"
        style={translateJoinPage && { transform: translateJoinPage }}
      >
        <div className="join-meet-page-video-optionbar-area">
          <div className="join-meet-page-video-area">
            {users.map(({ socketId, userName }) => {
              const isSelf = socket && socketId === socket.id;
              const stream = isSelf ? localStreamRef.current : remoteStreams[socketId];
              const remoteTrackState = stream ? {
                video: stream.getVideoTracks().some((t) => t.readyState === 'live'),
                audio: stream.getAudioTracks().some((t) => t.readyState === 'live'),
              } : { video: false, audio: false };
              const cameraOn = isSelf ? isCameraOn : (userMediaState[socketId]?.isCameraOn ?? remoteTrackState.video);
              const audioOn = isSelf ? isAudioOn : (userMediaState[socketId]?.isAudioOn ?? remoteTrackState.audio);
              return (
                <div key={socketId} className="join-meet-page-account-own-video">
                  {cameraOn && stream ? (
                    <video
                      autoPlay
                      playsInline
                      muted={isSelf}
                      style={{ transform: isSelf ? "scaleX(-1)" : "none", width: "115%", height: 270, background: "#000", objectFit: "cover" }}
                      ref={(el) => {
                        if (el && stream && el.srcObject !== stream) {
                          el.srcObject = stream;
                        }
                      }}
                    />
                  ) : (
                    <div className="join-meet-page-acouunt-own-holder-profile-picture">
                      {userName &&
                        userName
                          .split(" ")
                          .map((word) => word[0])
                          .join("")
                          .toUpperCase()}
                    </div>
                  )}
                  {!isSelf && stream && (
                    <audio
                      autoPlay
                      playsInline
                      ref={(el) => {
                        if (el && stream && el.srcObject !== stream) {
                          el.srcObject = stream;
                          el.play?.().catch(() => {});
                        }
                      }}
                    />
                  )}
                  <div className="join-meet-page-account-name">
                    {userName || userNameData}
                    {isSelf ? ' (You)' : ''}
                  </div>

                  {isSelf ? (
                    <div className="join-meet-page-optionbar-area-individual-outside">
                      <button
                        className="join-meet-page-optionbar-video-button"
                        onClick={() => toggleVideo(socketId)}
                      >
                        {cameraOn ? (
                          <svg xmlns="http://www.w3.org/2000/svg" height="25px" viewBox="0 -960 960 960" width="25px" fill="#e8eaed">
                            <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h480q33 0 56.5 23.5T720-720v180l160-160v440L720-420v180q0 33-23.5 56.5T640-160H160Zm0-80h480v-480H160v480Z" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" height="25px" viewBox="0 -960 960 960" width="25px" fill="#e8eaed">
                            <path d="M880-260 720-420v67l-80-80v-287H353l-80-80h367q33 0 56.5 23.5T720-720v180l160-160v440ZM822-26 26-822l56-56L878-82l-56 56ZM497-577ZM384-464ZM160-800l80 80h-80v480h480v-80l80 80q0 33-23.5 56.5T640-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800Z" />
                          </svg>
                        )}
                      </button>
                      <button
                        className="join-meet-page-optionbar-audio-button"
                        onClick={() => toggleAudio(socketId)}
                      >
                        {audioOn ? (
                          <svg xmlns="http://www.w3.org/2000/svg" height="25px" viewBox="0 -960 960 960" width="25px" fill="#e8eaed">
                            <path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-240Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Z" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" height="25px" viewBox="0 -960 960 960" width="25px" fill="#e8eaed">
                            <path d="m710-362-58-58q14-23 21-48t7-52h80q0 44-13 83.5T710-362ZM480-594Zm112 112-72-72v-206q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v126l-80-80v-46q0-50 35-85t85-35q50 0 85 35t35 85v240q0 11-2.5 20t-5.5 18ZM440-120v-123q-104-14-172-93t-68-184h80q0 83 57.5 141.5T480-320q34 0 64.5-10.5T600-360l57 57q-29 23-63.5 39T520-243v123h-80Zm352 64L56-792l56-56 736 736-56 56Z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div></div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="join-meet-page-optionbar-area">
            <button
              className="join-meet-page-optionbar-chat-button"
              onClick={handleParticipantsDisplay}
              title="Participants"
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="25px" viewBox="0 -960 960 960" width="25px" fill="#e8eaed">
                <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm-320 80q-33 0-56.5-23.5T80-480q0-33 23.5-56.5T160-560q33 0 56.5 23.5T240-480q0 33-23.5 56.5T160-400Zm640 0q-33 0-56.5-23.5T720-480q0-33 23.5-56.5T800-560q33 0 56.5 23.5T880-480q0 33-23.5 56.5T800-400ZM160-240v-80q0-33 23.5-56.5T240-400h120q33 0 56.5 23.5T440-320v80H160Zm360 0v-80q0-33 23.5-56.5T600-400h120q33 0 56.5 23.5T800-320v80H520Zm-40-160q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm0 160Z"/>
              </svg>
            </button>
            <button
              className="join-meet-page-optionbar-chat-button"
              onClick={handleChatBoxDisplay}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="25px"
                viewBox="0 -960 960 960"
                width="25px"
                fill="#e8eaed"
              >
                <path d="M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z" />
              </svg>
            </button>
            <button
              className="join-meet-page-optionbar-chat-button"
              onClick={handleInfoToggle}
              title="Meeting Info"
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="25px" viewBox="0 -960 960 960" width="25px" fill="#e8eaed">
                <path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/>
              </svg>
            </button>
            <button
              className="join-meet-page-optionbar-leave-button"
              onClick={leaveMeeting}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="40px"
                viewBox="0 -960 960 960"
                width="40px"
                fill="#e8eaed"
              >
                <path d="m136-304-92-90q-12-12-12-28t12-28q88-95 203-142.5T480-640q118 0 232.5 47.5T916-450q12 12 12 28t-12 28l-92 90q-11 11-25.5 12t-26.5-8l-116-88q-8-6-12-14t-4-18v-114q-38-12-78-19t-82-7q-42 0-82 7t-78 19v114q0 10-4 18t-12 14l-116 88q-12 9-26.5 8T136-304Zm104-198q-29 15-56 34.5T128-424l40 40 72-56v-62Zm480 2v60l72 56 40-38q-29-26-56-45t-56-33Zm-480-2Zm480 2Z" />
              </svg>
            </button>
          </div>
        </div>
        <div
          className="join-meet-page-chat-area"
          style={{ display: chatBoxDisp, transform: chatBoxTranslate }}
        >
          <div className="user-chat-input-box-wrapper">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '90%', paddingTop: 8 }}>
              <div style={{ fontSize: 27, fontWeight: 600, color: '#fff' }}>Chat</div>
              <button
                onClick={handleChatClose}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  color: '#fff',
                  fontSize: 18,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Close"
              >
                ✕
              </button>
            </div>
            <div className="user-chat-box-container"></div>
            <div className="user-chat-input-box">
              <input
                className="user-input"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addMessageBox();
                }}
                type="text"
              />
              <button
                className="user-message-send-button"
                onClick={addMessageBox}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="30px"
                  viewBox="0 -960 960 960"
                  width="30px"
                  fill="#FFFFFF"
                >
                  <path d="M120-160v-640l760 320-760 320Zm80-120 474-200-474-200v140l240 60-240 60v140Zm0 0v-400 400Z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div
          className="join-meet-page-chat-area"
          style={{ display: participantsDisp, transform: participantsTranslate }}
        >
          <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', color: '#fff', padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 27, fontWeight: 600 }}>Participants</div>
              <button
                onClick={handleParticipantsClose}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  color: '#fff',
                  fontSize: 18,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Close"
              >
                ✕
              </button>
            </div>
            <div
      style={{
        height: 34,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "start",
        marginBottom: 8,
        gap: 8,
      }}
    >
      Room Id:&nbsp;
      <span style={{ fontWeight: 700 }}>{joinedRoomId}</span>
      <button
        onClick={handleCopy}
        style={{
          marginLeft: 8,
          padding: "4px 10px",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          backgroundColor: isClicked ? "#0056b3" : "#007bff",
          color: "#fff",
          fontSize: 12,
          transform: isClicked ? "scale(0.9)" : "scale(1)",
          transition: "all 0.2s ease",
        }}
      >
        {isClicked ? "Copied!" : "Copy"}
      </button>
    </div>
            {/* <div style={{ height: 34, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'start',  marginBottom: 8}}>Room Id: &nbsp;&nbsp;<span style={{fontWeight: 700}}>{joinedRoomId}</span></div> */}
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {users.map(({ socketId, userName }) => {
                const isSelf = socket && socketId === socket.id;
                const stream = isSelf ? localStreamRef.current : remoteStreams[socketId];
                const remoteTrackState = stream ? {
                  video: stream.getVideoTracks().some((t) => t.readyState === 'live'),
                  audio: stream.getAudioTracks().some((t) => t.readyState === 'live'),
                } : { video: false, audio: false };
                const cameraOn = isSelf ? isCameraOn : (userMediaState[socketId]?.isCameraOn ?? remoteTrackState.video);
                const audioOn = isSelf ? isAudioOn : (userMediaState[socketId]?.isAudioOn ?? remoteTrackState.audio);
                return (
                  <div key={socketId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ height: 34, width: 34, borderRadius: '50%', background: '#161256', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                        {(userName || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 14 }}>{userName || 'User'}{isSelf ? ' (You)' : ''}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span title={cameraOn ? 'Camera on' : 'Camera off'} style={{ background: 'rgba(0,0,0,0.35)', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}>{cameraOn ? <svg xmlns="http://www.w3.org/2000/svg" height="15px" viewBox="0 -960 960 960" width="15px" fill="#e8eaed">
                            <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h480q33 0 56.5 23.5T720-720v180l160-160v440L720-420v180q0 33-23.5 56.5T640-160H160Zm0-80h480v-480H160v480Z" />
                          </svg> : <svg xmlns="http://www.w3.org/2000/svg" height="15px" viewBox="0 -960 960 960" width="15px" fill="#e8eaed">
                            <path d="M880-260 720-420v67l-80-80v-287H353l-80-80h367q33 0 56.5 23.5T720-720v180l160-160v440ZM822-26 26-822l56-56L878-82l-56 56ZM497-577ZM384-464ZM160-800l80 80h-80v480h480v-80l80 80q0 33-23.5 56.5T640-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800Z" />
                          </svg>}</span>
                      <span title={audioOn ? 'Mic on' : 'Mic off'} style={{ background: 'rgba(0,0,0,0.35)', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}>{audioOn ? <svg xmlns="http://www.w3.org/2000/svg" height="15px" viewBox="0 -960 960 960" width="15px" fill="#e8eaed">
                            <path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-240Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Z" />
                          </svg> : <svg xmlns="http://www.w3.org/2000/svg" height="15px" viewBox="0 -960 960 960" width="15px" fill="#e8eaed">
                            <path d="m710-362-58-58q14-23 21-48t7-52h80q0 44-13 83.5T710-362ZM480-594Zm112 112-72-72v-206q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v126l-80-80v-46q0-50 35-85t85-35q50 0 85 35t35 85v240q0 11-2.5 20t-5.5 18ZM440-120v-123q-104-14-172-93t-68-184h80q0 83 57.5 141.5T480-320q34 0 64.5-10.5T600-360l57 57q-29 23-63.5 39T520-243v123h-80Zm352 64L56-792l56-56 736 736-56 56Z" />
                          </svg>}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Meeting Info Modal */}
      {showInfoModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={handleInfoToggle}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #1e1e3f, #2b2d5e)',
              borderRadius: 20,
              padding: '28px 32px',
              width: 400,
              maxWidth: '90%',
              color: '#fff',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 24, fontWeight: 700 }}>Meeting Info</div>
              <button
                onClick={handleInfoToggle}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  color: '#fff',
                  fontSize: 18,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Info rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Host */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ height: 40, width: 40, borderRadius: '50%', background: '#4a3aff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>
                  {(userNameData || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Host</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{userNameData || 'You'}</div>
                </div>
              </div>

              {/* Participants */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ height: 40, width: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#e8eaed">
                    <path d="M0-240v-63q0-43 44-70t116-27q13 0 25 .5t23 2.5q-14 21-21 44t-7 48v65H0Zm240 0v-65q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v65H240Zm540 0v-65q0-26-6.5-49T754-397q11-2 22.5-2.5t23.5-.5q72 0 116 27t44 70v63H780ZM480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Z"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Participants</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{users.length}</div>
                </div>
              </div>

              {/* Room ID */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ height: 40, width: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#e8eaed">
                    <path d="M300-80q-58 0-99-41t-41-99v-520q0-58 41-99t99-41h20v-80h80v80h160v-80h80v80h20q58 0 99 41t41 99v520q0 58-41 99t-99 41H300Zm0-80h360q25 0 42.5-17.5T720-220v-520q0-25-17.5-42.5T660-800H300q-25 0-42.5 17.5T240-740v520q0 25 17.5 42.5T300-160Z"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Room ID</div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>{dynamicRoute}</div>
                </div>
              </div>

              {/* Meeting Link */}
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Meeting Link</div>
                <div style={{
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  border: '1px solid rgba(255,255,255,0.1)',
                  marginBottom: 12,
                }}>
                  <div style={{
                    fontSize: 13,
                    color: '#8b9cf7',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}>
                    {getMeetingLink()}
                  </div>
                  <button
                    onClick={handleCopyLink}
                    style={{
                      background: linkCopied ? '#22c55e' : 'linear-gradient(135deg, #4a3aff, #6c5ce7)',
                      border: 'none',
                      borderRadius: 8,
                      padding: '6px 16px',
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {linkCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                
                {/* Share Buttons */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <a
                    href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Join my meeting on Vi Meet! \n\nMeeting link: ${getMeetingLink()}`)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      background: '#25D366',
                      color: '#fff',
                      textDecoration: 'none',
                      padding: '10px',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 500,
                      transition: 'opacity 0.2s',
                    }}
                    onMouseOver={(e) => e.target.style.opacity = 0.9}
                    onMouseOut={(e) => e.target.style.opacity = 1}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.031 2.016A10 10 0 0 0 2.049 12.01a9.982 9.982 0 0 0 1.332 4.965L1.516 22.42l5.59-1.464a9.96 9.96 0 0 0 4.925 1.298h.004c5.522 0 10-4.478 10-10a9.974 9.974 0 0 0-2.926-7.07Q16.182 2.016 12.031 2.016zm.006 18.52h-.003a8.307 8.307 0 0 1-4.228-1.155l-.304-.18-3.141.823.839-3.064-.197-.313a8.312 8.312 0 0 1-1.272-4.456 8.32 8.32 0 0 1 8.318-8.317 8.28 8.28 0 0 1 5.88 2.434 8.284 8.284 0 0 1 2.434 5.883 8.318 8.318 0 0 1-8.326 8.345zm4.562-6.236c-.25-.125-1.482-.731-1.71-.814-.229-.084-.396-.125-.563.125-.167.25-.646.814-.792.981-.146.167-.292.188-.542.063-.25-.125-1.057-.39-2.013-1.24-.744-.664-1.246-1.486-1.392-1.734-.146-.25-.015-.386.11-.51.112-.112.25-.292.375-.438.125-.146.167-.25.25-.417.084-.167.042-.313-.021-.438-.063-.125-.562-1.354-.771-1.854-.203-.485-.411-.42-.562-.428l-.48-.008c-.167 0-.438.063-.667.313-.23.25-.875.854-.875 2.083 0 1.229.896 2.417 1.021 2.583.125.167 1.758 2.75 4.292 3.792.604.248 1.076.396 1.442.507.608.188 1.162.161 1.597.098.486-.071 1.482-.604 1.691-1.188.209-.583.209-1.083.146-1.187-.063-.105-.229-.168-.479-.293z"/></svg>
                    WhatsApp
                  </a>
                  <a
                    href={`mailto:?subject=${encodeURIComponent("Join my meeting on Vi Meet!")}&body=${encodeURIComponent(`Please join my meeting on Vi Meet using the following link:\n\n${getMeetingLink()}\n\nSee you there!`)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      background: '#ea4335',
                      color: '#fff',
                      textDecoration: 'none',
                      padding: '10px',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 500,
                      transition: 'opacity 0.2s',
                    }}
                    onMouseOver={(e) => e.target.style.opacity = 0.9}
                    onMouseOut={(e) => e.target.style.opacity = 1}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                    Gmail
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JoinMeetPage;