import LoginScreen from "@/components/shared/LoginScreen";
import ThemeToggle from "@/components/shared/ThemeToggle";

export default function LoginPage() {
  return (
    <>
      <div className="fixed top-4 right-4 z-[90]">
        <ThemeToggle />
      </div>
      <LoginScreen />
    </>
  );
}
