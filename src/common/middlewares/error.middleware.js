const AppError = require('../utils/AppError');

module.exports.notFoundHandler = (req, res, next) => {
    next(new AppError(404, "Page Not Found!"));
};

module.exports.errorHandler = (err, req, res, next) => {
    console.error(err);
    if (res.headersSent) {
        return next(err);
    }
    let { statusCode = 500, message = "something went wrong" } = err;
    res.status(statusCode).render("error.ejs", { message });
};
