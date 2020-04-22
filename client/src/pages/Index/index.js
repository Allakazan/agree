import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import ReactLoading from 'react-loading';
import FadeIn from 'react-fade-in';

import api from '../../services/api'
import CanvasAnimation from '../../components/CanvasAnimation'

import './styles.css';

import logo from '../../assets/logo.png';

export default function Index() {
    const [rooms, setRooms] = useState([])
    const [loading, setLoading] = useState(true)
    const [userName, setUserName] = useState('')
    const [userNameInvalid, setUserNameInvalid] = useState(false)
    const [selectedRoom, setSelectedRoom] = useState('default')
    const [selectedRoomInvalid, setSelectedRoomInvalid] = useState(false)

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
    
        setUserNameInvalid(userName === '')
        setSelectedRoomInvalid(selectedRoom === 'default')

        if (userName === '' || selectedRoom === 'default') return

        setLoading(true)

        const { token } = (await api.post('auth', { username: userName })).data
        
        localStorage.setItem('auth', token);
        history.push(`/chat/${selectedRoom}`)
    }

    return (
        <div className="container-index">
            <img className="app-logo" src={logo} alt='Agree Logo'/>
            <section className="section-wrapper animated bounceIn">
                {loading ? (
                    <div className="section-loading">
                        <FadeIn>
                            <ReactLoading type='bubbles' color='#7289da' width={80} />
                        </FadeIn>
                    </div>
                )
                : (
                    <div>
                        <p className="title header-primary">Welcome again !</p>
                        <p className="subtitle header-secondary">Agree is a messaging app for heroes. Let's chat !</p>
                        <form onSubmit={handleRegister}>
                            <label className={userNameInvalid ? 'input-error' : ''}>
                                USERNAME {userNameInvalid ? <i>- This field is required</i> : ''}
                            </label>
                            <input 
                                type="text" className={userNameInvalid ? 'input-error' : ''}  autoComplete="off" placeholder="Type a username"
                                value={userName}
                                onChange={e => setUserName(e.target.value)}
                            />
                            <label className={selectedRoomInvalid ? 'input-error' : ''}>
                                SERVER {selectedRoomInvalid ? <i>- Select a server to talk</i> : ''}
                            </label>
                            <select className={selectedRoomInvalid ? 'input-error' : ''} 
                                onChange={e => setSelectedRoom(e.target.value)} >
                                <option value='default' defaultValue>Select a server</option>
                                {rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                            </select>
                            <button type="submit">Continue</button>
                        </form>
                    </div>
                )}
            </section>
            <CanvasAnimation/>
        </div>
    );
  }
  