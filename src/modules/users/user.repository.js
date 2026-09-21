const User = require("./user.model.js");

class UserRepository {
    async findById(id, projection = null) {
        return User.findById(id, projection);
    }

    async findByUsername(username) {
        return User.findOne({ username });
    }

    async register(userData, password) {
        const newUser = new User(userData);
        return User.register(newUser, password);
    }
}

module.exports = new UserRepository();
