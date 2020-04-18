import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import io from 'socket.io-client';
import api from '../../services/api'

import './styles.css';

export default function Chat({ match }) {
    const room = match.params.room;
    const images = require.context('../../assets', true);

    const [roomName, setRoomName] = useState('');
    const [roomId, setRoomId] = useState('');
    const [roomImage, setRoomImage] = useState('');

    const [userInfo, setUserInfo] = useState({
        id: '',
        name: '',
        tag: '',
        avatar: ''
    });

    const [connectedUsers, setConnectedUsers] = useState([]);

    const history = useHistory();

    useEffect(() => {
        async function init() {
            let token = localStorage.getItem('auth');

            try {
                const { id, name, image } = (await api.get(`rooms/${room}`)).data;
                const { auth, user } = (await api.get('auth', {
                    headers: {
                        Authorization: token
                    }
                })).data;
                
                if (!auth) throw new Error("Unauthorized access.");
    
                const { avatar } = (await api.get(`media/${user.id}`)).data;

                setRoomId(id);
                setRoomName(name);
                setRoomImage(images('./' + image));
    
                setUserInfo({
                    id: user.id,
                    name: user.name,
                    tag: user.tag,
                    avatar
                })

            } catch (err) {
                console.log(err)
                history.push('/')
            }
        }
        init();
    }, [room, history, images]);

    useEffect(() => {
        if (userInfo.id) {
            let socket = io('/chat')

            socket.on('connect', () => {
                socket.emit('join-request', { 
                    roomId,
                    userId: userInfo.id,
                    userName: userInfo.name,
                    userTag: userInfo.tag
                })
            })

            socket.on('new-user-joined-room', (data) => {
                if (socket.id === data.socket) {
                    socket.emit('get-all-users-in-room', roomId, (users) => setConnectedUsers(users))
                } else {
                    setConnectedUsers(connectedUsers => [...connectedUsers, data.user])
                }
            });

            socket.on('user-joined-new-tab', () => {
                socket.emit('get-all-users-in-room', roomId, (users) => setConnectedUsers(users))
            });

            socket.on('user-disconnected', (id) => {
                setConnectedUsers(connectedUsers => connectedUsers.filter(user => user.id !== id))
            });

            return () => socket.close();
        }
    }, [roomId, userInfo]);

    return (
        <div className="container-chat">
            <div className="sidebar">
                <div className="room-area" style={{'--bg-room': `url(${roomImage})`}}>
                    <h1>{roomName} room</h1>
                </div>
                <div className="list-users-area">
                    <p className="user-count">Na Sala - <span id="userCount" data-count={connectedUsers.length}></span></p>
                    <ul className="connected-users">
                        {connectedUsers.map(user => (
                            <li key={user.id}>
                                <div className="c-thumb-wrapper">
                                    <a href="#"><img src=""/></a>
                                </div>
                                <div className="c-user-area-data">
                                    <p className="c-username">{user.name}</p>
                                    <span className="c-userid">{user.usertag}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>            
                <div className="user-area">
                    <div className="thumb-wrapper">
                        <img src={userInfo.avatar} alt=""/>
                    </div>
                    <div className="user-area-data">
                        <p className="username">{userInfo.name}</p>
                        <span className="userid">{userInfo.tag}</span>
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
  