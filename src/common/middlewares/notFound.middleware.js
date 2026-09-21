const AppError = require('../utils/AppError');

module.exports = (req, res, next) => {
    next(new AppError(404, "Page Not Found!"));
};
