module.exports = {
  apps: [{
    name: 'serveurclaude',
    script: 'index.js',
    cwd: '/var/www/serveurclaude',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    error_file: '/var/log/serveurclaude/error.log',
    out_file: '/var/log/serveurclaude/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
