const rooms = require('../model/rooms');
const { urlFriendly } = require('../helpers/UrlHelper')

module.exports = {
    index(request, response) {
        return response.json(rooms);
    },
    search(request, response) {
        let id = request.params.room;
        let room = rooms.find(x => x.id == id);
    
        if (!room) return response.status(404).json({'message': 'No room matching ' + id});
            
        return response.json({
            id: id,
            name: room.name,
            image: urlFriendly(room.name) + '.jpg'
        })
    }
}