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

    const [messageInput, setMessageInput] = useState('');
    const [receivedMessages, setReceivedMessages] = useState([]);

    const [socket] = useState(io('/chat', { autoConnect: false }));

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
    
                setRoomId(id);
                setRoomName(name);
                setRoomImage(images('./' + image));
    
                setUserInfo(user);

            } catch (err) {
                console.log(err)
                history.push('/')
            }
        }
        init();
    }, [room, history, images]);

    useEffect(() => {
        if (userInfo.id && !socket.connected) {

            socket.open()

            /** Connection Events */

            socket.on('connect', () => {
                socket.emit('join-request', Object.assign({ room: roomId }, userInfo))
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

            /** Message Events */

            socket.on('new-message', ({ msg, sender, timestamp}) => {
                const message = {
                    msg,
                    sender,
                    timestamp
                }

                setReceivedMessages(receivedMessages => [...receivedMessages, message])
            });

            return () => socket.close();
        }
    }, [roomId, userInfo, socket]);

    function handleChatInput(e) {
        e.preventDefault();

        if (messageInput !== '' && socket.connected) {
            socket.emit('send-message', { room: roomId, user: userInfo.id, msg: messageInput });

            setMessageInput('');
        }
    }

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
                                    <img src={user.avatar} alt=""/>
                                </div>
                                <div className="c-user-area-data">
                                    <p className="c-username">{user.name}</p>
                                    <span className="c-userid">{user.tag}</span>
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
                    <ul className="message-wrapper">
                        {receivedMessages.map(message => (
                            <li key={message.timestamp}>
                                <div className="image-wrapper">
                                    <img src={message.sender.avatar} alt=""/>
                                </div>
                                <div className="text-wrapper">
                                    <p className="title">{message.sender.name} <span className="date timeago">{message.timestamp}</span></p>
                                    <p className="msg">{message.msg}</p>  
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="bottom-section">
                    <form onSubmit={handleChatInput}>
                        <input id="inputMessage" type="text" autoComplete="off" placeholder={`Talk in ${roomName} room`} 
                            value={messageInput} onChange={e => setMessageInput(e.target.value)} />
                    </form>
                </div>
            </div>
        </div>
    );
  }
  