const fs = require('fs');
const path = require('path');
const { sendSuccess, sendError } = require('../utils/apiResponse');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

exports.uploadBase64Image = async (req, res, next) => {
  try {
    const { image, filename } = req.body;
    
    if (!image) {
      return sendError(res, {
        code: ERROR_CODES.BAD_REQUEST,
        message: 'No image data provided'
      }, HTTP_STATUS.BAD_REQUEST);
    }

    // Extract base64 string
    const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return sendError(res, {
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Invalid base64 string'
      }, HTTP_STATUS.BAD_REQUEST);
    }

    const type = matches[1];
    const data = Buffer.from(matches[2], 'base64');

    // Create uploads directory if it doesn't exist
    const publicDir = path.join(__dirname, '../../public');
    const uploadsDir = path.join(publicDir, 'uploads');
    
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir);
    }
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir);
    }

    // Generate unique filename
    const ext = type.split('/')[1] || 'png';
    const uniqueFilename = `${Date.now()}-${Math.round(Math.random() * 1E9)}.${ext}`;
    const filePath = path.join(uploadsDir, uniqueFilename);

    // Write file
    fs.writeFileSync(filePath, data);

    const fileUrl = `/uploads/${uniqueFilename}`;

    return sendSuccess(res, { url: fileUrl }, HTTP_STATUS.OK);
  } catch (error) {
    next(error);
  }
};
