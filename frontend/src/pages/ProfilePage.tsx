// frontend/src/pages/ProfilePage.tsx
//
// 任何登录用户都能用的"个人资料"自助编辑页——跟 SettingsPage.tsx 不是
// 一回事，那个是 operator 专用的系统设置（素材储存网址等），这个是每
// 个人改自己的姓名/头像/联络方式，走 authApi.updateMe，只能改自己，不
// 接受也不需要传别人的 id。

import { useState, useEffect } from "react";
import { authApi } from "@/api";
import { useAuthStore } from "@/stores/index";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent } from "@/components/ui/index";
import toast from "react-hot-toast";

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [fullNameZh, setFullNameZh] = useState("");
  const [fullNameEn, setFullNameEn] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    authApi.me().then((me) => {
      setFullNameZh(me.full_name_zh ?? "");
      setFullNameEn(me.full_name_en ?? "");
      setPreferredName(me.preferred_name ?? "");
      setAvatarUrl(me.avatar_url ?? "");
      setBio(me.bio ?? "");
      setEmail(me.email ?? "");
      setMobile(me.mobile ?? "");
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await authApi.updateMe({
        full_name_zh: fullNameZh || undefined, full_name_en: fullNameEn || undefined,
        preferred_name: preferredName || undefined, avatar_url: avatarUrl || undefined,
        bio: bio || undefined, email: email || undefined, mobile: mobile || undefined,
      });
      toast.success("资料已更新");
      // 顶部头像/名字用的是全局登录状态里的 user，改完资料要顺手刷新一下，
      // 不然要重新登录一次才会在别的地方（比如右上角下拉菜单）看到新的
      const fresh = await authApi.me();
      setUser(fresh);
    } catch { toast.error("更新失败"); } finally { setSaving(false); }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">个人资料</h1>
        <p className="text-sm text-muted-foreground mt-1">只能改自己的资料——账号名、密码、角色这些不在这里，密码修改在别处单独处理。</p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal-500 to-blue-600 flex items-center justify-center text-white text-xl font-bold shrink-0 overflow-hidden">
              {avatarUrl ? <img src={avatarUrl} alt="头像" className="w-full h-full object-cover" /> : (fullNameZh || user?.username || "?").slice(0, 1)}
            </div>
            <div className="flex-1 space-y-1.5">
              <Label>头像链接（选填）</Label>
              <Input placeholder="https://..." value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>中文姓名</Label><Input value={fullNameZh} onChange={(e) => setFullNameZh(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>英文姓名</Label><Input value={fullNameEn} onChange={(e) => setFullNameEn(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>常用称呼（显示在欢迎语、右上角）</Label><Input placeholder="如：小明" value={preferredName} onChange={(e) => setPreferredName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>简介（选填）</Label><Input value={bio} onChange={(e) => setBio(e.target.value)} /></div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>邮箱</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>手机号</Label><Input value={mobile} onChange={(e) => setMobile(e.target.value)} /></div>
          </div>

          <Button className="w-full" onClick={handleSave} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
