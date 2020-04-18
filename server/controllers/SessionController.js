const escape = require('escape-html');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');


module.exports = {
    async index(request, response) {
        const token = request.headers.authorization;

        if (!token) return response.status(401).json({ auth: false, message: 'No token provided.' });
        
        await jwt.verify(token, process.env.SECRET, function(err, decoded) {
          if (err) return response.status(401).json({ auth: false, message: 'Failed to authenticate token.' });
          
          return response.json({ auth: true, user: decoded })
        });
    },
    async create(request, response) {
        const { username } = request.body;

        const data = {
            id: uuidv4(),
            name: escape(username),
            tag: '#'+ new Date().getMilliseconds().toString().padStart(4, 0)
        }

        const token = jwt.sign(
            data,
            process.env.SECRET,
            { expiresIn: 10000 }
        );

        return response.json({ token })
    }
}