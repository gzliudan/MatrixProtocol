module.exports = {
  semi: true,
  singleQuote: true,
  trailingComma: 'es5',
  bracketSpacing: true,
  overrides: [
    {
      files: '*.sol',
      options: {
        printWidth: 160,
        tabWidth: 4,
        useTabs: false,
        singleQuote: false,
        explicitTypes: 'always',
      },
    },
  ],
};
