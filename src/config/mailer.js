import nodemailer from "nodemailer";
import logger from "./logger.js";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = parseInt(process.env.SMTP_PORT || "2525");
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || '"Green Future Tech" <no-reply@greenfuturetech.com>';

let transporter;

if (smtpHost && smtpUser && smtpPass) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465, // true for 465, false for other ports
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });
  logger.info("Nodemailer SMTP Transporter configured successfully");
} else {
  logger.warn("SMTP email settings not fully configured. Emails will be logged to console instead.");
  // Mock transporter
  transporter = {
    sendMail: async (mailOptions) => {
      logger.info(`[MOCK EMAIL SENT]
To: ${mailOptions.to}
Subject: ${mailOptions.subject}
HTML: ${mailOptions.html.substring(0, 200)}...`);
      return { messageId: "mock-id-" + Date.now() };
    },
  };
}

export const sendEmail = async ({ to, subject, html }) => {
  try {
    const info = await transporter.sendMail({
      from: smtpFrom,
      to,
      subject,
      html,
    });
    return info;
  } catch (error) {
    logger.error(`Error sending email to ${to}: ${error.message}`);
    throw error;
  }
};

export default sendEmail;
