import React from "react";
import Profile from "./profile"
import { useNavigate } from 'react-router-dom';
// import LoginAuthPage from "./loginAuth";

import logo from "../assets/logo.png";

export default function NavbarComponent({ loginCard, isLoggedIn, setIsLoggedIn, onSuccess }) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate('/meet');
  };

  const handleLogin = () =>{
    navigate('/login')
    loginCard()

  }


  return (
    <>
      <div className="navbar-wrapper">
        <div className="navbar-logo-container">
          <img
            src={logo}
            alt="Vi Meet Logo"
            style={{
              height: "35px",
              width: "35px",
              borderRadius: "50%",
              objectFit: "cover",
            }}
          />
          <div
            style={{
              color: "white",
              fontSize: "20px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Vi Meet
          </div>
        </div>
        <div className="navbar-items-container">
          <li>
            <a href="/">Home</a>
          </li>
          <li>
            <a href="/">About</a>
          </li>
          <li>
            <a href="/">Support</a>
          </li>
          <li>
            <a href="/">Apps</a>
          </li>
        </div>
        <div className="navbar-button-container">
          <button className="navbar-login-button" onClick={handleLogin}>
            Login
          </button>
          <button className="navbar-join-button" onClick={handleClick}>
            Join Meet
            </button>
            {isLoggedIn && <Profile isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn} onSuccess={onSuccess}></Profile>}
        </div>
      </div>
    </>
  );
}