# AI Regression Agent - Installation Guide

This project is a TypeScript CLI for a local AI regression agent that handles automated testing, evaluation, and reporting.

## Prerequisites

Before installing dependencies, ensure you have the following installed on your system:

- **Node.js** (v18 or later) - [Download here](https://nodejs.org/)
- **npm** (v9 or later) - Comes with Node.js
- **Git** (optional, for version control)

## Project Structure

The project has a monorepo structure with:
- Root-level shared configuration
- `ai-regression-agent/` - Main application package

## Installation Steps

### 1. Clone or Navigate to the Project

```bash
cd "path/to/model ai"
```

### 2. Install Root Dependencies

Install dependencies for the root workspace:

```bash
npm install
```

### 3. Install AI Agent Dependencies

Navigate to the AI regression agent directory and install dependencies:

```bash
cd ai-regression-agent
npm install
cd ..
```

## Dependencies

### Main Dependencies

- **typescript** (^5.6.0 or ^5.9.3) - TypeScript compiler
- **ts-node** (^10.9.2) - TypeScript execution for Node.js
- **playwright** (^1.50.0 or ^1.58.2) - Browser automation for testing
- **@playwright/test** (^1.50.0) - Testing framework for Playwright
- **xlsx** (^0.18.5) - Excel file manipulation for reporting
- **readline-sync** (^1.4.10) - Synchronous user input handling
- **dotenv** (^17.3.1) - Environment variable management
- **node-fetch** (^3.3.2) - Fetch API for Node.js

### Development Dependencies

- **@types/node** - TypeScript types for Node.js
- **@types/readline-sync** - TypeScript types for readline-sync
- **typescript** - TypeScript compiler
- **ts-node** - TypeScript execution

## Available Scripts

### Build

Compile TypeScript to JavaScript:

```bash
npm run build
```

### Development

Run the application in development mode with ts-node:

```bash
npm run dev
```

### Launch

Run the auto-launch script:

```bash
npm run launch
```

### Start (Production)

Run the compiled JavaScript:

```bash
npm start
```

## Environment Configuration

Create a `.env` file in the root directory if needed for environment variables:

```bash
# Example .env file
NODE_ENV=development
```

Refer to your configuration requirements for specific environment variables.

## Troubleshooting

### Common Issues

**Port Already in Use**
- Change the port in your configuration

**Module Not Found**
- Ensure all dependencies are installed: `npm install`
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`

**TypeScript Compilation Errors**
- Verify TypeScript version: `npm list typescript`
- Rebuild: `npm run build`

**Playwright Browser Issues**
- Install Playwright browsers: `npx playwright install`

## Next Steps

After installation:

1. Review the project structure in `src/`
2. Check the main entry point: `src/index.ts`
3. Review environment configuration requirements
4. Run `npm run dev` to start development

## Additional Resources

- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Playwright Documentation](https://playwright.dev/)
- [XLSX Documentation](https://github.com/SheetJS/sheetjs)

## License

This project is licensed under the MIT/ISC License.
