const userService = require("./user.service.js");

module.exports.getProfile = async (req, res) => {
    const user = await userService.getUserById(req.user._id);
    res.json(user);
};
