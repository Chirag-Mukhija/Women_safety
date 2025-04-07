const nodemailer = require('nodemailer');

const sendEmail = async (to, subject, text) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,      // ✅ your Gmail address
      pass: process.env.EMAIL_PASS       // ✅ your App Password from Gmail
    }
  });

  const mailOptions = {
    from: `"Women Safety App" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
