const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const env = require('../../config/env');

cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'wanderlust_DEV',
        allowedFormats: ["png", "jpg", "jpeg"]
    },
});

const upload = multer({ storage });

module.exports = {
    cloudinary,
    storage,
    upload
};
