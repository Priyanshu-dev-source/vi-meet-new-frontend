import React, { useState } from "react";
import Profile from "./profile"
import { useNavigate } from 'react-router-dom';
// import LoginAuthPage from "./loginAuth";

import logo from "../assets/logo.png";

export default function NavbarComponent({ loginCard, isLoggedIn, setIsLoggedIn, onSuccess }) {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleClick = () => {
    navigate('/meet');
    setMobileMenuOpen(false);
  };

  const handleLogin = () =>{
    navigate('/login')
    loginCard()
    setMobileMenuOpen(false);
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
        <button className="navbar-hamburger" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" height="28px" viewBox="0 0 24 24" width="28px" fill="#fff">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" height="28px" viewBox="0 0 24 24" width="28px" fill="#fff">
              <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
            </svg>
          )}
        </button>
      </div>
      {mobileMenuOpen && (
        <div className="navbar-mobile-menu">
          <ul className="navbar-mobile-items">
            <li><a href="/" onClick={() => setMobileMenuOpen(false)}>Home</a></li>
            <li><a href="/" onClick={() => setMobileMenuOpen(false)}>About</a></li>
            <li><a href="/" onClick={() => setMobileMenuOpen(false)}>Support</a></li>
            <li><a href="/" onClick={() => setMobileMenuOpen(false)}>Apps</a></li>
          </ul>
          <div className="navbar-mobile-buttons">
            <button className="navbar-login-button" onClick={handleLogin}>Login</button>
            <button className="navbar-join-button" onClick={handleClick}>Join Meet</button>
          </div>
        </div>
      )}
    </>
  );
}