// pm2 process config for the backend on EC2. Start with: pm2 start ecosystem.config.cjs
// Reloaded by the GitHub Actions deploy workflow after each merge to main.
module.exports = {
  apps: [
    {
      name: 'cinematch-api',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
