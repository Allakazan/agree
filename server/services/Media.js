const fs = require('fs');
const path = require('path');
const dir = path.dirname(require.main.filename);
const avatar = require('avatar-builder');
const avatarGenerator = avatar.builder(
    avatar.Image.circleMask(
        avatar.Image.identicon()
    ),
    64, 64, { cache: avatar.Cache.lru() }
)

module.exports = {
    async createAvatar(string) {
        try {
            const buffer = await avatarGenerator.create(string);
            const imageName = string + '.png';
            const imagePath = path.join(dir, 'storage', 'avatar', imageName);
            
            fs.writeFileSync(imagePath, buffer);
            
            return '/avatar/' + imageName;
        } catch(err) {
            console.log(err)
            return false;
        }
    }
}