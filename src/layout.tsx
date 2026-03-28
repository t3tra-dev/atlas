import { AppSidebar } from "@/components/app-sidebar";
import { DocumentPane } from "@/components/document/pane";
import { DocumentStoreProvider } from "@/components/document/store";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { HandLandmarkerOverlay } from "@/components/vision/hand-landmarker-overlay";
import { useTheme, type ThemeMode } from "@/hooks/use-theme";
import {
  CameraIcon,
  CameraOffIcon,
  FlipHorizontalIcon,
  MicIcon,
  MicOffIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import * as React from "react";
import type { ReactNode } from "react";

export default function Layout({ children }: { children?: ReactNode }) {
  const { theme, setTheme } = useTheme();
  type CameraPermissionState = "granted" | "denied" | "prompt" | "unknown";
  const [cameraEnabled, setCameraEnabled] = React.useState(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem("atlas.camera.enabled");
    return stored === "true";
  });
  const [cameraMirrored, setCameraMirrored] = React.useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("atlas.camera.mirrored");
    return stored === null ? true : stored === "true";
  });
  const [cameraPermission, setCameraPermission] = React.useState<CameraPermissionState>("unknown");
  const permissionInitRef = React.useRef(false);
  type MicPermissionState = "granted" | "denied" | "prompt" | "unknown";
  const [micEnabled, setMicEnabled] = React.useState(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem("atlas.mic.enabled");
    return stored === "true";
  });
  const [micPermission, setMicPermission] = React.useState<MicPermissionState>("unknown");
  const micPermissionInitRef = React.useRef(false);
  const themeIcon =
    theme === "dark" ? (
      <MoonIcon className="size-4" />
    ) : theme === "light" ? (
      <SunIcon className="size-4" />
    ) : (
      <MonitorIcon className="size-4" />
    );

  React.useEffect(() => {
    if (!navigator.permissions?.query) {
      setCameraPermission("unknown");
      return;
    }

    let active = true;
    let status: PermissionStatus | null = null;

    const applyPermission = (state: CameraPermissionState) => {
      if (!active) return;
      setCameraPermission(state);
      if (!permissionInitRef.current && state === "granted") {
        permissionInitRef.current = true;
        setCameraEnabled(true);
      }
    };

    navigator.permissions
      .query({ name: "camera" as PermissionName })
      .then((result) => {
        status = result;
        applyPermission(result.state);
        result.onchange = () => applyPermission(result.state);
      })
      .catch(() => {
        applyPermission("unknown");
      });

    return () => {
      active = false;
      if (status) status.onchange = null;
    };
  }, []);

  React.useEffect(() => {
    if (!navigator.permissions?.query) {
      setMicPermission("unknown");
      return;
    }

    let active = true;
    let status: PermissionStatus | null = null;

    const applyPermission = (state: MicPermissionState) => {
      if (!active) return;
      setMicPermission(state);
      if (!micPermissionInitRef.current && state === "granted") {
        micPermissionInitRef.current = true;
      }
    };

    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        status = result;
        applyPermission(result.state);
        result.onchange = () => applyPermission(result.state);
      })
      .catch(() => {
        applyPermission("unknown");
      });

    return () => {
      active = false;
      if (status) status.onchange = null;
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("atlas.camera.enabled", String(cameraEnabled));
  }, [cameraEnabled]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("atlas.mic.enabled", String(micEnabled));
  }, [micEnabled]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("atlas.camera.mirrored", String(cameraMirrored));
  }, [cameraMirrored]);

  React.useEffect(() => {
    if (!micEnabled) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    let active = true;

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.getTracks().forEach((track) => track.stop());
      })
      .catch(() => {
        // Permission denied or unavailable.
      });

    return () => {
      active = false;
    };
  }, [micEnabled]);

  return (
    <div className="min-h-svh flex flex-col">
      <SidebarProvider className="flex flex-1 min-h-0 min-w-0 flex-col">
        <DocumentStoreProvider>
          <div className="flex flex-1 min-h-0 min-w-0">
            <AppSidebar />

            <SidebarInset>
              <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                <SidebarTrigger className="md:hidden" />
                <div className="text-sm font-semibold">Atlas</div>
                <div className="ml-auto flex items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={micPermission === "denied" ? "マイク権限が必要" : "マイク設定"}
                      >
                        {micEnabled ? (
                          <MicIcon className="size-4" />
                        ) : (
                          <MicOffIcon className="size-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Microphone</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={micEnabled}
                        onCheckedChange={(checked) => {
                          setMicEnabled(Boolean(checked));
                        }}
                      >
                        <MicIcon className="size-4" />
                        {micPermission === "denied" ? "Microphone (Blocked)" : "Microphone"}
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={
                          cameraPermission === "denied" ? "カメラ権限が必要" : "カメラ設定"
                        }
                      >
                        {cameraEnabled ? (
                          <CameraIcon className="size-4" />
                        ) : (
                          <CameraOffIcon className="size-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Camera</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={cameraEnabled}
                        onCheckedChange={(checked) => {
                          setCameraEnabled(Boolean(checked));
                        }}
                      >
                        <CameraIcon className="size-4" />
                        {cameraPermission === "denied" ? "Camera (Blocked)" : "Camera"}
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={cameraMirrored}
                        onCheckedChange={(checked) => setCameraMirrored(Boolean(checked))}
                      >
                        <FlipHorizontalIcon className="size-4" />
                        Mirror
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="テーマ切り替え">
                        {themeIcon}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Theme</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup
                        value={theme}
                        onValueChange={(value) => setTheme(value as ThemeMode)}
                      >
                        <DropdownMenuRadioItem value="system">
                          <MonitorIcon className="size-4" />
                          System
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="light">
                          <SunIcon className="size-4" />
                          Light
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="dark">
                          <MoonIcon className="size-4" />
                          Dark
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </header>

              <div className="relative flex flex-1 min-h-0 min-w-0">
                <HandLandmarkerOverlay
                  enabled={cameraEnabled}
                  mirrored={cameraMirrored}
                  className={cameraEnabled ? "z-0" : "hidden"}
                  onPermissionChange={(state) => setCameraPermission(state)}
                  onRequestDisable={() => setCameraEnabled(false)}
                />
                <DocumentPane className="relative z-10 flex-1 min-w-0 bg-background/70">
                  {children}
                </DocumentPane>
              </div>
            </SidebarInset>
          </div>
        </DocumentStoreProvider>
      </SidebarProvider>
    </div>
  );
}
