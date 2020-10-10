import React, { useRef, forwardRef, useImperativeHandle  } from 'react';
import Moment from 'react-moment';
import { Twemoji } from 'react-emoji-render';

export default forwardRef(function TextChannel({ loadedMessages, inputValue, setInputValue, sendMessage, room }, ref) {

    const chatWrapper = useRef();

    useImperativeHandle(ref, () => ({
        scrollToBottom() {
            chatWrapper.current.scrollTop = chatWrapper.current.scrollHeight
        }
    }));

    return (
        <div className="chat-wrapper">
            <div className="board-wrapper" ref={chatWrapper}>
                <ul className="message-wrapper">
                    {loadedMessages.map(message => (
                        <li key={message.timestamp}>
                            <div className="image-wrapper">
                                <img src={message.sender.avatar} alt=""/>
                            </div>
                            <div className="text-wrapper">
                                <p className="title">{message.sender.name} <Moment fromNow interval={30000} element="span" className="date">{message.timestamp}</Moment></p>
                                <p className="msg"><Twemoji text={message.msg} className='agree-emoji' onlyEmojiClassName="agree-emoji-large" /></p>  
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
            <div className="bottom-section">
                <form onSubmit={sendMessage}>
                    <input id="inputMessage" type="text" autoComplete="off" placeholder={`Talk in ${room} room`} 
                        value={inputValue} onChange={e => setInputValue(e.target.value)} />
                </form>
            </div>
        </div>
    );
})