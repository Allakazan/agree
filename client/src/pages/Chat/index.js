import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import api from '../../services/api'

import './styles.css';

export default function Chat({ match }) {
    const room = match.params.room;
    const images = require.context('../../assets', true);

    const [roomName, setRoomName] = useState('');
    const [roomId, setRoomId] = useState('');
    const [roomImage, setRoomImage] = useState('');

    const [userName, setUserName] = useState('');
    const [userId, setUserId] = useState('');
    const [userAvatar, setUserAvatar] = useState('');

    const history = useHistory();

    useEffect(() => {
        api.get(`rooms/${room}`)
        .then(response => {
            let {id, name, image} = response.data;

            setRoomId(id);
            setRoomName(name);
            setRoomImage(images('./' + image));
        })
        .catch(err => {
            console.log(err)
            history.push('/')
        })
    }, [room, history, images]);

    return (
        <div className="container-chat">
            <div className="sidebar">
                <div className="room-area" style={{'--bg-room': `url(${roomImage})`}}>
                    <h1>{roomName} room</h1>
                </div>
                <div className="list-users-area">
                    <p className="user-count">Na Sala - <span id="userCount" data-count=""></span></p>
                    <ul className="connected-users"></ul>
                </div>            
                <div className="user-area">
                    <div className="thumb-wrapper">
                        <img src={userAvatar} alt=""/>
                    </div>
                    <div className="user-area-data">
                        <p className="username">{userName}</p>
                        <span className="userid">{userId}</span>
                    </div>
                </div>
            </div>
            <div className="chat-wrapper">
                <div className="board-wrapper">
                    <ul id="messages" className="message-wrapper"></ul>
                </div>
                <div className="bottom-section">
                    <form action="">
                        <input id="inputMessage" type="text" autoComplete="off" placeholder={`Talk in ${roomName} room`} />
                    </form>
                </div>
            </div>
        </div>
    );
  }
  