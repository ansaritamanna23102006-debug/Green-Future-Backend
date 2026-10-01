import nodemailer from "nodemailer";
import logger from "./logger.js";

const isPlaceholder = (val) => {
  if (!val) return true;
  const s = String(val).trim().toLowerCase();
  return (
    s === "" ||
    s.includes("your_smtp") ||
    s.includes("example.com") ||
    s.includes("change_me") ||
    s === "your_smtp_username" ||
    s === "your_smtp_password"
  );
};

export const getMailerConfig = () => {
  const smtpService = process.env.SMTP_SERVICE?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPort = parseInt(process.env.SMTP_PORT || "465", 10);
  const smtpUser = process.env.SMTP_USER?.trim();
  const rawPass = process.env.SMTP_PASS?.trim();
  // Strip spaces from Google App Passwords (e.g., "abcd efgh ijkl mnop" -> "abcdefghijklmnop")
  const smtpPass = rawPass ? rawPass.replace(/\s+/g, "") : "";
  const smtpFrom = process.env.SMTP_FROM?.trim() || (smtpUser ? `"Green Future Tech" <${smtpUser}>` : '"Green Future Tech" <no-reply@greenfuturetech.com>');

  const isConfigured = !isPlaceholder(smtpUser) && !isPlaceholder(smtpPass);

  return {
    smtpService,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    smtpFrom,
    isConfigured,
  };
};

export const createTransporter = () => {
  const config = getMailerConfig();

  if (config.isConfigured) {
    const isGmail =
      config.smtpService?.toLowerCase() === "gmail" ||
      config.smtpHost?.toLowerCase().includes("gmail") ||
      config.smtpUser?.toLowerCase().endsWith("@gmail.com") ||
      config.smtpUser?.toLowerCase().endsWith("@googlemail.com");

    if (isGmail) {
      return nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass,
        },
      });
    }

    if (config.smtpHost) {
      return nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465,
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass,
        },
        tls: {
          rejectUnauthorized: false,
        },
      });
    }
  }

  return {
    isMock: true,
    sendMail: async (mailOptions) => {
      logger.warn(`[MOCK EMAIL DISPATCHED] To: ${mailOptions.to} | Subject: ${mailOptions.subject}. (Configure Gmail SMTP in Backend/.env to send real emails)`);
      return { messageId: "mock-" + Date.now(), isMock: true };
    },
  };
};

export const sendEmail = async ({ to, subject, html }) => {
  const config = getMailerConfig();
  const transporter = createTransporter();

  try {
    if (transporter.isMock) {
      return await transporter.sendMail({
        from: config.smtpFrom,
        to,
        subject,
        html,
      });
    }

    const info = await transporter.sendMail({
      from: config.smtpFrom,
      to,
      subject,
      html,
    });
    logger.info(`[EMAIL SENT] Successfully dispatched email to ${to}. MessageId: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error(`Error sending email to ${to}: ${error.message}`);
    throw error;
  }
};

export default sendEmail;

