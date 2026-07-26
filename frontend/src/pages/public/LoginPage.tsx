// frontend/src/pages/public/LoginPage.tsx
//
// Adapted from LifeVerse's LoginPage — same form/validation/token-handling
// logic (that part is fully generic and untouched), but:
//   - identity field now prompts for IC/username specifically, not
//     "username or email or mobile" (staff/student accounts are IC-based)
//   - PARENTS now DO have public self-registration (see 2.5 in the
//     architecture doc, the family journey) — added a link to /register.
//     Students/staff still don't self-register; those accounts are created
//     by a teacher/operator or by a parent adding a child.

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "@/stores/index";
import { authApi } from "@/api/index";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent } from "@/components/ui/index";
import { Eye, EyeOff, Lock, User } from "lucide-react";
import toast from "react-hot-toast";

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth  = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ identity: "", password: "" });
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.identity || !form.password) {
      toast.error("请输入身份证/出生证号码和密码");
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.login(form);
      const { accessToken, refreshToken, user, forcedOtherDevicesLogout } = res.data.data;
      localStorage.setItem("accessToken",  accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      setAuth(user, accessToken, refreshToken);
      if (forcedOtherDevicesLogout) {
        toast.success("登入成功（其他装置已自动登出）");
      } else {
        toast.success("欢迎回来！");
      }
      navigate("/home");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "登入失败";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen star-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="mx-auto h-14 w-14 rounded-full bg-gradient-to-br from-primary to-blue-500 flex items-center justify-center text-white font-bold text-xl mb-3">
            LG
          </div>
          <h1 className="text-2xl font-bold">欢迎回来</h1>
          <p className="text-sm text-muted-foreground mt-1">登入 LogiVerse 账号</p>
        </div>

        <Card>
          <CardContent className="pt-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="identity">身份证 / 出生证号码</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="identity"
                    placeholder="例如 991231-14-5566"
                    className="pl-9"
                    value={form.identity}
                    onChange={(e) => setForm({ ...form, identity: e.target.value })}
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={show ? "text" : "password"}
                    placeholder="请输入密码"
                    className="pl-9 pr-9"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    autoComplete="current-password"
                  />
                  <button type="button" onClick={() => setShow(!show)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full" loading={loading}>
                登入
              </Button>
            </form>

            <p className="text-center text-xs text-muted-foreground mt-4">
              学生/老师账号请联系业者创建。家长还没账号？<Link to="/register" className="text-primary hover:underline">立即注册（3天免费试用）</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
