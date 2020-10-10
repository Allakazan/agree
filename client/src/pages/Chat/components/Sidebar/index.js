import React from 'react';
import FadeIn from 'react-fade-in';

export default function Sidebar({ roomName, roomImage, users, info }) {

    return (
        <div className="sidebar">
            <div className="room-area" style={{'--bg-room': `url(${roomImage})`}}>
                <h1>{roomName} room</h1>
            </div>
            <div className="list-users-area">
                <p className="user-count">Na Sala - <span id="userCount" data-count={users.length}></span></p>
                <ul className="connected-users">
                    {users.map(user => (
                        <FadeIn transitionDuration='300' key={user.id}>
                            <li>
                                <div className="c-thumb-wrapper">
                                    <img src={user.avatar} alt=""/>
                                </div>
                                <div className="c-user-area-data">
                                    <p className="c-username">{user.name}</p>
                                    <span className="c-userid">{user.tag}</span>
                                </div>
                            </li>
                        </FadeIn>
                    ))}
                </ul>
            </div>            
            <div className="user-area">
                <div className="thumb-wrapper">
                    <img src={info.avatar} alt=""/>
                </div>
                <div className="user-area-data">
                    <p className="username">{info.name}</p>
                    <span className="userid">{info.tag}</span>
                </div>
            </div>
        </div>
    );
}