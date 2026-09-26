const path = require('path');
const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
    mode: 'development',
    devtool: 'inline-source-map',
    devServer: {
        // The page, its config and the models are served straight off the repo;
        // only the bundle comes out of memory
        static: { directory: path.resolve(__dirname), watch: false },
        devMiddleware: { publicPath: '/build/' },
        port: 8080,
        host: '0.0.0.0',
        allowedHosts: 'all',
        hot: false,
        liveReload: false,
        client: { overlay: false }
    },
});
