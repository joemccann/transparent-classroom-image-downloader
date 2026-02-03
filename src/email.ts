import nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

interface EmailConfig {
  enabled: boolean;
  to: string;
  from: string;
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
  };
}

interface DownloadSummary {
  childName: string;
  count: number;
}

let transporter: Transporter | null = null;
let emailConfig: EmailConfig | null = null;

export function initializeEmail(): boolean {
  const enabled = process.env.EMAIL_ENABLED === 'true';

  if (!enabled) {
    console.log('Email notifications disabled');
    return false;
  }

  const to = process.env.EMAIL_TO;
  const from = process.env.EMAIL_FROM;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!to || !from || !host || !user || !pass) {
    console.log('Email configuration incomplete. Required: EMAIL_TO, EMAIL_FROM, SMTP_HOST, SMTP_USER, SMTP_PASS');
    return false;
  }

  emailConfig = {
    enabled: true,
    to,
    from,
    smtp: { host, port, user, pass },
  };

  transporter = nodemailer.createTransport({
    host: emailConfig.smtp.host,
    port: emailConfig.smtp.port,
    secure: emailConfig.smtp.port === 465,
    auth: {
      user: emailConfig.smtp.user,
      pass: emailConfig.smtp.pass,
    },
  });

  console.log('Email notifications enabled');
  return true;
}

export async function sendSuccessEmail(downloads: DownloadSummary[]): Promise<boolean> {
  if (!transporter || !emailConfig) {
    return false;
  }

  const totalPhotos = downloads.reduce((sum, d) => sum + d.count, 0);

  if (totalPhotos === 0) {
    return true; // Nothing to report
  }

  const childSummaries = downloads
    .filter(d => d.count > 0)
    .map(d => `• ${d.childName}: ${d.count} photo${d.count === 1 ? '' : 's'}`)
    .join('\n');

  const subject = `📸 ${totalPhotos} new photo${totalPhotos === 1 ? '' : 's'} downloaded from Transparent Classroom`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2d3748;">New Photos Downloaded</h2>
      <p style="color: #4a5568; font-size: 16px;">
        ${totalPhotos} new photo${totalPhotos === 1 ? ' has' : 's have'} been downloaded from Transparent Classroom.
      </p>
      <div style="background: #f7fafc; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <h3 style="color: #2d3748; margin-top: 0;">Summary</h3>
        <pre style="color: #4a5568; font-size: 14px; margin: 0;">${childSummaries}</pre>
      </div>
      <p style="color: #718096; font-size: 14px;">
        Downloaded at: ${new Date().toLocaleString()}
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailConfig.from,
      to: emailConfig.to,
      subject,
      html,
      text: `New Photos Downloaded\n\n${totalPhotos} new photo${totalPhotos === 1 ? ' has' : 's have'} been downloaded.\n\n${childSummaries}\n\nDownloaded at: ${new Date().toLocaleString()}`,
    });
    console.log('Success email sent');
    return true;
  } catch (error) {
    console.error('Failed to send success email:', error);
    return false;
  }
}

export async function sendAuthErrorEmail(): Promise<boolean> {
  if (!transporter || !emailConfig) {
    return false;
  }

  const subject = '⚠️ Transparent Classroom: Re-authentication Required';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #c53030;">Authentication Required</h2>
      <p style="color: #4a5568; font-size: 16px;">
        The Transparent Classroom photo downloader was unable to authenticate.
        Your session may have expired.
      </p>
      <div style="background: #fff5f5; border: 1px solid #feb2b2; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <h3 style="color: #c53030; margin-top: 0;">Action Required</h3>
        <p style="color: #742a2a; margin-bottom: 0;">
          Please sign in to <a href="https://www.transparentclassroom.com" style="color: #c53030;">Transparent Classroom</a>
          in Chrome to restore access.
        </p>
      </div>
      <p style="color: #718096; font-size: 14px;">
        Attempted at: ${new Date().toLocaleString()}
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailConfig.from,
      to: emailConfig.to,
      subject,
      html,
      text: `Authentication Required\n\nThe Transparent Classroom photo downloader was unable to authenticate. Your session may have expired.\n\nPlease sign in to Transparent Classroom in Chrome to restore access.\n\nAttempted at: ${new Date().toLocaleString()}`,
    });
    console.log('Auth error email sent');
    return true;
  } catch (error) {
    console.error('Failed to send auth error email:', error);
    return false;
  }
}

export async function sendErrorEmail(errorMessage: string): Promise<boolean> {
  if (!transporter || !emailConfig) {
    return false;
  }

  const subject = '❌ Transparent Classroom: Download Error';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #c53030;">Download Error</h2>
      <p style="color: #4a5568; font-size: 16px;">
        The Transparent Classroom photo downloader encountered an error.
      </p>
      <div style="background: #fff5f5; border: 1px solid #feb2b2; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <h3 style="color: #c53030; margin-top: 0;">Error Details</h3>
        <pre style="color: #742a2a; font-size: 14px; margin: 0; white-space: pre-wrap; word-wrap: break-word;">${errorMessage}</pre>
      </div>
      <p style="color: #718096; font-size: 14px;">
        Occurred at: ${new Date().toLocaleString()}
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailConfig.from,
      to: emailConfig.to,
      subject,
      html,
      text: `Download Error\n\nThe Transparent Classroom photo downloader encountered an error.\n\nError Details:\n${errorMessage}\n\nOccurred at: ${new Date().toLocaleString()}`,
    });
    console.log('Error email sent');
    return true;
  } catch (error) {
    console.error('Failed to send error email:', error);
    return false;
  }
}
