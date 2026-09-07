const User = require("../users/user.model.js");

class AuthService {
    async registerUser(userData, password) {
        let { username, email } = userData;
        const newUser = new User({ email, username });
        return await User.register(newUser, password);
    }
}

module.exports = new AuthService();
