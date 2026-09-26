const path = require('path');

module.exports = {
    entry: {
        app: './src/ts/sketchbook.ts'
    },
    output: {
        filename: 'sketchbook.min.js',
        library: {
            name: 'Sketchbook',
            type: 'umd'
        },
        path: path.resolve(__dirname, 'build'),
        publicPath: 'build/'
    },
    resolve: {
        alias: {
          cannon: path.resolve(__dirname, './src/lib/cannon/cannon.js')
        },
        extensions: [ '.tsx', '.ts', '.js' ],
    },
    module: {
        rules: [
        {
            test: /\.tsx?$/,
            use: 'ts-loader',
            exclude: /node_modules/,
        },
        {
            test: /\.css$/,
            use: [
                { loader: 'style-loader', options: { injectType: 'singletonStyleTag' } },
                { loader: 'css-loader' },
            ]
        }
      ]
    },
    performance: {
        hints: false
    }
};
