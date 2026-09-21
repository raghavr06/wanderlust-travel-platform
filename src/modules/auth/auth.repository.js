const userRepository = require("../users/user.repository.js");

class AuthRepository {
    async registerUser(userData, password) {
        let { username, email } = userData;
        return userRepository.register({ email, username }, password);
    }
}

module.exports = new AuthRepository();
