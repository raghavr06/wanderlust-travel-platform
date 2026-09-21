const authRepository = require("./auth.repository.js");

class AuthService {
    async registerUser(userData, password) {
        return authRepository.registerUser(userData, password);
    }
}

module.exports = new AuthService();
