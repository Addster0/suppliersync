import { Outlet } from "react-router-dom";
import { SetupProvider } from "../contexts/SetupContext";
import { AppChrome } from "../components/AppChrome";
import { SetupGuide } from "../components/SetupGuide";

export function AppLayout() {
  return (
    <SetupProvider>
      <AppChrome>
        <Outlet />
      </AppChrome>
      <SetupGuide />
    </SetupProvider>
  );
}
