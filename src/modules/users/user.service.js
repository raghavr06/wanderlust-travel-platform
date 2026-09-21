const userRepository = require("./user.repository.js");

class UserService {
    async getUserById(id) {
        return userRepository.findById(id);
    }
}

module.exports = new UserService();
