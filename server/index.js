var app = require('express')();
var path = require('path');
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var mustacheExpress = require('mustache-express');

const Avatar = require('avatar-builder');

const rooms = require('./model/rooms');
const api = require('./api');

const PORT = process.env.PORT || 3000

let findRoom = function (room, callback) {
    if (!rooms[room])
        return callback(new Error('No room matching ' + room));

    return callback(null, rooms[room]);
};

app.engine('html', mustacheExpress())

app.set('view engine', 'html')
app.set('views', path.resolve(__dirname+'/../views'))

app.use(require('express').static(path.resolve(__dirname+'/../public')));

app.use('/api', api);

app.get('/', function(req, res) {
    res.render('index')
});

app.get('/chat/:room', function(req, res, next) {
    let room = req.params.room;

    findRoom(room, function(error, roomObj) {
        if (error) return next(error);
        return res.render('chat', {room: {id: room, data: roomObj}})
    });
});

/*app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist/index.html'));
});*/


const avatarGenerator = Avatar.builder(
    Avatar.Image.circleMask(
        Avatar.Image.identicon()
    ),
    64, 64, {cache: Avatar.Cache.lru()}
)

var connectedUsers = {}

const chat = io.of('/chat');

chat.on('connection', function(socket){
    console.log('a user connected')

    socket.on('join-request', function(data) {

        socket.join(data.roomId, function () {

            avatarGenerator.create(socket.id)
            .then(buffer => 'data:image/png;base64, ' + buffer.toString('base64'))
            .then((blob) => {
                connectedUsers[socket.id] = {
                    id: socket.id,
                    room: data.roomId,
                    name: data.userName,
                    avatar: blob,
                    usertag: '#'+ new Date().getMilliseconds().toString().padStart(4, 0)
                }
    
                chat.to(data.roomId).emit('new-user-joined-room', connectedUsers[socket.id]);
            })
        });

        socket.on('send-message', function(data) {
            chat.to(data.roomId).emit('new-message', {msg: data.msg, sender: connectedUsers[socket.id], timestamp: Date.now()})
        })
    
        socket.on('disconnect', function(){
            let room = connectedUsers[socket.id].room

            delete connectedUsers[socket.id]
        
            socket.leave(room)
            chat.to(room).emit('user-disconnected', socket.id);
        })
    })
});

http.listen(PORT, function(){
    console.log('listening on *:3000');
})