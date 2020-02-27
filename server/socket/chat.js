const escape = require('escape-html');
const avatar = require('avatar-builder');
const rooms = require('../model/rooms');

module.exports = function(io) {

    const avatarGenerator = avatar.builder(
        avatar.Image.circleMask(
            avatar.Image.identicon()
        ),
        64, 64, {cache: avatar.Cache.lru()}
    )
    
    let connectedUsers = {}
    const chat = io.of('/chat');

    chat.on('connection', function(socket) {
    
        socket.on('join-request', function(data) {
    
            socket.join(data.roomId, function () {
    
                avatarGenerator.create(socket.id)
                .then(buffer => 'data:image/png;base64, ' + buffer.toString('base64'))
                .then((blob) => {
                    connectedUsers[socket.id] = {
                        id: socket.id,
                        room: data.roomId,
                        name: escape(data.userName),
                        avatar: blob,
                        usertag: '#'+ new Date().getMilliseconds().toString().padStart(4, 0)
                    }
        
                    chat.to(data.roomId).emit('new-user-joined-room', connectedUsers[socket.id]);
                    console.log('\x1b[33m' + data.userName + '\x1b[0m connected in \x1b[32m' + rooms[data.roomId].name + '\x1b[0m room')
                })
            });
    
            socket.on('send-message', function(data) {
                chat.to(data.roomId).emit('new-message', {msg: escape(data.msg), sender: connectedUsers[socket.id], timestamp: Date.now()})
            })
        
            socket.on('disconnect', function() {
                let room = connectedUsers[socket.id].room
                let name = connectedUsers[socket.id].name
    
                delete connectedUsers[socket.id]
            
                socket.leave(room)
                chat.to(room).emit('user-disconnected', socket.id);

                console.log('\x1b[33m' + name + '\x1b[0m \x1b[41mdisconnected\x1b[0m from \x1b[32m' + rooms[room].name + '\x1b[0m room')
            })
        })
    });

}