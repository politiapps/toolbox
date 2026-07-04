import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
	appId: "app.toolbox.tasks",
	appName: "Toolbox Tasks",
	webDir: "dist",
	android: {
		// We manage our own dark/light theming in CSS.
		backgroundColor: "#1e1e1e",
	},
};

export default config;
