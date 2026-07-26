// frontend/src/pages/public/RegisterPage.tsx
//
// Public parent self-registration — the entry point to the family journey
// (2.5 in the architecture doc): register → add a child → 3-day trial
// starts automatically → subscribe to keep going. Students/staff still
// don't get this — only PARENT accounts self-register.

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "@/stores/index";
import { familyApi, authApi } from "@/api/index";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent } from "@/components/ui/index";
import toast from "react-hot-toast";

export default function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) { toast.error("请填写邮箱和密码"); return; }
    if (password.length < 8) { toast.error("密码至少要8个字符"); return; }
    if (password !== confirmPassword) { toast.error("两次输入的密码不一样"); return; }

    setLoading(true);
    try {
      await familyApi.registerParent({ email, password, full_name_zh: fullName || undefined });
      toast.success("注册成功！正在登入...");
      // register → immediately log in, so the new parent lands straight on
      // "add your child" instead of having to type their credentials twice
      const loginRes = await authApi.login({ identity: email, password });
      const { accessToken, refreshToken, user } = loginRes.data.data;
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      setAuth(user, accessToken, refreshToken);
      navigate("/family");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "注册失败";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen star-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto h-14 w-14 rounded-full bg-gradient-to-br from-primary to-blue-500 flex items-center justify-center text-white font-bold text-xl mb-3">
            LG
          </div>
          <h1 className="text-2xl font-bold">家长注册</h1>
          <p className="text-sm text-muted-foreground mt-1">注册后可以马上为孩子开始 3 天免费试用</p>
        </div>

        <Card>
          <CardContent className="pt-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">您的姓名（选填）</Label>
                <Input id="fullName" placeholder="怎么称呼您" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">邮箱</Label>
                <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">密码</Label>
                <Input id="password" type="password" placeholder="至少8个字符" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">确认密码</Label>
                <Input id="confirmPassword" type="password" placeholder="再输入一次" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <Button type="submit" className="w-full" loading={loading}>注册</Button>
            </form>
            <p className="text-center text-xs text-muted-foreground mt-4">
              已经有账号？<Link to="/login" className="text-primary hover:underline">登入</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
