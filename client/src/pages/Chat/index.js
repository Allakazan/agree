import React, { useRef, useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import ReactLoading from 'react-loading';
import FadeIn from 'react-fade-in';
import io from 'socket.io-client';
import api from '../../services/api'
import Notifications from '../../services/notifications'

import Sidebar from './components/Sidebar'
import TextChannel from './components/TextChannel'

import './styles.css';

export default function Chat({ match }) {
    const room = match.params.room;
    const images = require.context('../../assets/rooms', true);

    const [loading, setLoading] = useState(true);

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

    const channelRef = useRef();
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

            Notifications.init()
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
                setLoading(false);
            });

            socket.on('user-joined-new-tab', () => {
                socket.emit('get-all-users-in-room', roomId, (users) => setConnectedUsers(users))
                
                setLoading(false);
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

                if (Notifications.shouldNotifyUser()) {
                    Notifications.notify(`New message from ${sender.name}`)
                }
                
                channelRef.current.scrollToBottom();
            });

            return () => {
                socket.close();
                Notifications.destroy();
            }
        }
    }, [roomId, userInfo, socket]);

    function setInputValue(value) {
        setMessageInput(value)
    }

    function handleChatInput(e) {
        e.preventDefault();

        if (messageInput !== '' && socket.connected) {
            socket.emit('send-message', { room: roomId, user: userInfo.id, msg: messageInput });

            setMessageInput('');
        }
    }

    return (
        <div className="app-wrapper">
            {loading ? (
                <div className="container-loading">
                    <FadeIn transitionDuration='200'>
                        <ReactLoading type='bubbles' color='#7248d8' width={120} />
                    </FadeIn>
                </div>
            )
            : (
                <div className="container-chat">
                    <Sidebar 
                        roomName={roomName}
                        roomImage={roomImage}
                        users={connectedUsers}
                        info={userInfo} 
                    />
                    <TextChannel
                        loadedMessages={receivedMessages}
                        inputValue={messageInput}
                        setInputValue={setInputValue}
                        sendMessage={handleChatInput}
                        room={roomName}
                        ref={channelRef}
                    />
                </div>
            )}
        </div>
    );
  }
  