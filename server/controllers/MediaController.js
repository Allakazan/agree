const avatar = require('avatar-builder');
const avatarGenerator = avatar.builder(
    avatar.Image.circleMask(
        avatar.Image.identicon()
    ),
    64, 64, { 
        cache: avatar.Cache.compose(avatar.Cache.lru(), avatar.Cache.folder())
    }
)

module.exports = {
    async index(request, response) {
        try {
            const blob = await avatarGenerator.create( request.params.room )
                .then(buffer => 'data:image/png;base64, ' + buffer.toString('base64'));

            return response.send({ avatar: blob })
        } catch(err) {
            return response.status(400).json({ avatar: false, message: 'Failed to create user avatar.' })
        }
    }
}