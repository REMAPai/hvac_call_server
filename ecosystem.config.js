module.exports = {
    apps: [
      {
        name: "hvac_call_server",
        script: "./main.js",
        instances: 1,
        autorestart: true,
        watch: false,
        max_restarts: 10,
        restart_delay: 5000,
        env: {
          NODE_ENV: "production",
          PORT: 3091,
        },
      },
    ],
  };
  