import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';

import api from '../../services/api'
import CanvasAnimation from '../../components/CanvasAnimation'

import './styles.css';

export default function Index() {
    const [rooms, setRooms] = useState([])
    const [loading, setLoading] = useState(true)
    const [userName, setUserName] = useState('')
    const [selectedRoom, setSelectedRoom] = useState(0)

    const history = useHistory();

    useEffect(() => {
        api.get('rooms')
        .then(response => {
            setRooms(response.data)
            setLoading(false)
        })
    }, []);

    async function handleRegister(e) {
        e.preventDefault()
        setLoading(true)

        const { token } = (await api.post('auth', { username: userName })).data
        
        localStorage.setItem('auth', token);
        history.push(`/chat/${selectedRoom}`)
    }

    return (
        <div className="container-index">
            <section className="section-wrapper animated bounceIn">
                <div className="lds-ring loading" style={{display: loading ? null : 'none'}}><div></div><div></div><div></div><div></div></div>
                <div style={{display: loading ? 'none' : null}}>
                    <p className="title header-primary">Welcome to Agree</p>
                    <p className="subtitle header-secondary">Welcome to my webchat, please input your user name and choose the server to start
                        talking !</p>
                    <form onSubmit={handleRegister}>
                        <input 
                            type="text" className="userName" placeholder="Your Name" autoComplete="off"
                            value={userName}
                            onChange={e => setUserName(e.target.value)}
                        />
                        <select onChange={e => setSelectedRoom(e.target.value)}>
                            <option value={selectedRoom} defaultValue>Select server</option>
                            {rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                        </select>
                        <button type="submit">Continue</button>
                    </form>
                </div>
            </section>
            <CanvasAnimation/>
        </div>
    );
  }
  