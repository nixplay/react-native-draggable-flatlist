const peerModule = [
	'^react$',
	'^react-native$',
];

module.exports = {
	"env": {
		"browser": true
	},
	"extends": "airbnb",
	"globals": {
		"__DEV__": true
	},
	"parser": "babel-eslint",
	"parserOptions": {
		"ecmaVersion": 6,
		"ecmaFeatures": { "legacyDecorators": true }
	},
	"rules": {
		"react/jsx-filename-extension": ["error", { extensions: [".js", ".jsx"] }],
		"indent": [2, 2, { "SwitchCase": 1, "VariableDeclarator": 1 }],
		"no-tabs": 0,
		"max-len": [2, { "code": 120, "tabWidth": 1, "ignoreComments": true, "ignoreTrailingComments": true, "ignoreUrls": true, "ignoreStrings": true, "ignoreTemplateLiterals": true, "ignoreRegExpLiterals": true }],
		"arrow-parens": 0,
		"react/jsx-indent": [2, 2],
		"react/jsx-indent-props": [2, 2],
		"react/forbid-prop-types": 0,
		"react/prefer-stateless-function": 0,
		"import/prefer-default-export": 0,
    "quotes": [2, "single", "avoid-escape"],
    "no-underscore-dangle": 0,
		"import/extensions": [2, { ignore: peerModule }],
		"import/no-unresolved": [2, { ignore: peerModule }]
	},
	"settings": {
		"import/resolver": {
			"babel-module": {}
		}
	}
};
