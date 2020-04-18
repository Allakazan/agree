const emoji = require('emoji-js');
const rooms = require('../model/rooms');

module.exports = function(io) {

    const emojiParser = new emoji.EmojiConvertor()

    let escapeMessage = function(str) {

        emojiParser.colons_mode = true
        str = emojiParser.replace_unified(str)

        return str
    }

    let connectedUsers = []

    let findUserByID = function (id) {
        return connectedUsers.find(u => u.id == id);
    }

    let findUsersByRoom = function (room) {
        return connectedUsers.filter(u => u.room == room);
    }

    let findUserByIDAndRoom = function (id, room) {
        return connectedUsers.find(u => u.id == id && u.room == room);
    }

    let findUserBySocket = function (socket) {
        return connectedUsers.find(u => u.socket.includes(socket));
    }

    const chat = io.of('/chat');

    chat.on('connection', function(socket) {
    
        socket.on('join-request', function(data) {

            socket.join(data.room, function () {
                const room = rooms.find(x => x.id == data.room);
                const user = findUserByIDAndRoom(data.id, data.room);
                
                if (user) {
                    connectedUsers[connectedUsers.indexOf(user)].socket.push(socket.id);
                    socket.emit('user-joined-new-tab');
                } else {
                    const newUser = {
                        id: data.id,
                        socket: [ socket.id ],
                        room: data.room,
                        name: data.name,
                        tag: data.tag,
                        avatar: data.avatar
                    };
    
                    connectedUsers.push(newUser);
                    chat.to(data.room).emit('new-user-joined-room', {socket: socket.id, user: newUser});
                }

                console.log('\x1b[33m' + data.name + '\x1b[0m connected in \x1b[32m' + room.name + '\x1b[0m room');
            });
        })

        socket.on('get-all-users-in-room', function(room, callback) {
            callback(findUsersByRoom(room))
        });

        socket.on('send-message', function(data) {
            chat.to(data.room).emit('new-message', {msg: escapeMessage(data.msg), sender: findUserByID(data.user), timestamp: Date.now()})
        })
    
        socket.on('disconnect', function() {
            const user = findUserBySocket(socket.id);

            // For unknown reasons the disconnect event fires at random moments
            // This is a workaround to not crash the application
            if (user) {
                const room = rooms.find(x => x.id == user.room);
                const userIndex = connectedUsers.indexOf(user);

                if (connectedUsers[userIndex].socket.length > 1) {
                    connectedUsers[userIndex].socket.splice(user.socket.indexOf(socket.id), 1)
                } else {
                    connectedUsers.splice(userIndex, 1);
                    chat.to(user.room).emit('user-disconnected', user.id);
                }

                socket.leave(user.room);
                console.log('\x1b[33m' + user.name + '\x1b[0m \x1b[41mdisconnected\x1b[0m from \x1b[32m' + room.name + '\x1b[0m room');
            }
        })
    });

}