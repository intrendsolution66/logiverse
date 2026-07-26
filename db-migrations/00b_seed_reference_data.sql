--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: ancestries; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.ancestries (id, code, label_en, label_zh, label_ms, sort_order, is_active) FROM stdin;
019ef9d3-0922-7838-9191-21868bb81373	FUJIAN	Fujian (Hokkien)	福建	Fujian	1	t
019ef9d3-0924-7e6b-be63-4e87d48e2e0b	GUANGDONG	Guangdong	广东	Guangdong	2	t
019ef9d3-0924-7c82-accb-fc7d9a6ef8aa	HAKKA	Hakka	客家	Hakka	3	t
019ef9d3-0924-70a7-b213-4200a1884b94	TEOCHEW	Teochew	潮州	Teochew	4	t
019ef9d3-0924-72ad-a90f-796b6dc340f0	CANTONESE	Cantonese	广府	Kantonis	5	t
019ef9d3-0924-71ab-999c-2993979fa06d	HAINANESE	Hainanese	海南	Hainan	6	t
019ef9d3-0924-783c-a413-44188e656a3e	FOOCHOW	Foochow	福州	Fuzhou	7	t
019ef9d3-0924-70dc-8f96-1fed36d10e73	MALAYSIA	Malaysia-born	马来西亚本地	Malaysia	10	t
019ef9d3-0924-7601-b392-131adb56801a	OTHER	Other	其他	Lain-lain	99	t
\.


--
-- Data for Name: countries; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.countries (id, code_alpha2, code_alpha3, label_en, label_zh, label_ms, phone_code, sort_order, is_active) FROM stdin;
019ef9d3-092b-760e-a066-f07c7bebc69d	MY	MYS	Malaysia	马来西亚	Malaysia	+60	1	t
019ef9d3-092d-76ec-b98c-99201a5aff78	SG	SGP	Singapore	新加坡	Singapura	+65	2	t
019ef9d3-092d-711c-859b-25c0cfbbc81e	CN	CHN	China	中国	China	+86	3	t
019ef9d3-092d-7dbd-8a9f-3a570e2c7769	TW	TWN	Taiwan	台湾	Taiwan	+886	4	t
019ef9d3-092d-76fe-b511-959571fe5358	HK	HKG	Hong Kong	香港	Hong Kong	+852	5	t
019ef9d3-092d-7e5d-ac08-0c3e866f5ce7	ID	IDN	Indonesia	印尼	Indonesia	+62	6	t
019ef9d3-092d-7134-9382-b359bf82a53b	TH	THA	Thailand	泰国	Thailand	+66	7	t
019ef9d3-092d-7e64-9408-24835d93f0b1	PH	PHL	Philippines	菲律宾	Filipina	+63	8	t
019ef9d3-092d-7b62-8d7c-dd6b8f45b447	IN	IND	India	印度	India	+91	9	t
019ef9d3-092d-78cb-bb63-cbf1486700dc	AU	AUS	Australia	澳大利亚	Australia	+61	10	t
019ef9d3-092d-7cb2-9324-5310f88a30d7	GB	GBR	United Kingdom	英国	United Kingdom	+44	11	t
019ef9d3-092d-77ba-9557-a5dc848e088f	US	USA	United States	美国	Amerika Syarikat	+1	12	t
019ef9d3-092d-792a-b889-28a1805a83d1	JP	JPN	Japan	日本	Jepun	+81	13	t
019ef9d3-092d-7803-908e-a0d077dc52aa	KR	KOR	South Korea	韩国	Korea Selatan	+82	14	t
\.


--
-- Data for Name: education_levels; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.education_levels (id, code, label_en, label_zh, label_ms, sort_order, is_active) FROM stdin;
019ef9d3-0926-7aa5-bcf0-1c699e1a2acb	PRIMARY	Primary School	小学	Sekolah Rendah	1	t
019ef9d3-0928-775c-b277-72690e8a4246	SECONDARY	Secondary School	中学	Sekolah Menengah	2	t
019ef9d3-0928-7b19-9176-21955930e3bd	DIPLOMA	Diploma	文凭	Diploma	3	t
019ef9d3-0928-7096-80c8-50bc9e15eaa1	BACHELOR	Bachelor Degree	学士	Ijazah Sarjana Muda	4	t
019ef9d3-0928-7ad1-9e24-4e170755d3ad	MASTER	Master Degree	硕士	Ijazah Sarjana	5	t
019ef9d3-0928-7d9c-b9e0-f9179550eafb	PHD	PhD / Doctorate	博士	Doktor Falsafah	6	t
019ef9d3-0928-719f-93f6-e35f3885fc33	PROFESSIONAL	Professional Cert	专业认证	Sijil Profesional	7	t
019ef9d3-0928-7ce0-8795-573ef64acb6c	OTHER	Other	其他	Lain-lain	9	t
\.


--
-- Data for Name: ethnicities; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.ethnicities (id, code, label_en, label_zh, label_ms, sort_order, is_active) FROM stdin;
019ef9d3-0920-7244-811c-41a9a3153708	MALAY	Malay	马来人	Melayu	1	t
019ef9d3-0922-70f0-86d2-86325ede9bbc	CHINESE	Chinese	华人	Cina	2	t
019ef9d3-0922-7fbe-b82e-e81bc6ea60f7	INDIAN	Indian	印度人	India	3	t
019ef9d3-0922-766a-908e-004dc6744cba	IBAN	Iban	伊班族	Iban	4	t
019ef9d3-0922-7ada-9303-b350cd113d47	KADAZAN	Kadazan-Dusun	卡达山人	Kadazan-Dusun	5	t
019ef9d3-0922-70da-8d66-6d4d74bb3715	BAJAU	Bajau	巴夭族	Bajau	6	t
019ef9d3-0922-74f3-965f-365f9ac18476	ORANG_ASLI	Orang Asli	原住民	Orang Asli	7	t
019ef9d3-0922-7d64-87a8-e76fc3e81c61	EURASIAN	Eurasian	欧亚裔	Eurasian	8	t
019ef9d3-0922-71bb-9060-c018c74e768f	EXPATRIATE	Expatriate	外籍人士	Warga Asing	9	t
019ef9d3-0922-7ec2-b1bb-f1a1567183c4	OTHER	Other	其他	Lain-lain	99	t
\.


--
-- Data for Name: genders; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.genders (id, code, label_en, label_zh, label_ms, sort_order, is_active) FROM stdin;
019ef9d3-091c-732c-89f2-c903fe7e92d0	M	Male	男	Lelaki	1	t
019ef9d3-091e-7d62-9967-395bbc008131	F	Female	女	Perempuan	2	t
019ef9d3-091e-713d-81fa-710671bffac0	OTHER	Other	其他	Lain-lain	3	t
019ef9d3-091e-7aa4-b74e-b7d0d57e54b8	PREFER_NOT	Prefer not to say	不愿透露	Tidak mahu nyatakan	9	t
\.


--
-- Data for Name: identity_providers; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.identity_providers (id, code, label_en, label_zh, provider_type, is_enabled, allow_login, allow_register, require_verification, client_id, client_secret, authorization_url, token_url, userinfo_url, scopes, callback_url, extra_config, sort_order, is_system, created_at, updated_at) FROM stdin;
019ef9d3-092f-79db-897d-89fa1e72e5a4	LOCAL	Username & Password	用户名密码	local	t	t	t	f	\N	\N	\N	\N	\N	\N	\N	{}	1	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0931-7b8a-9911-29f4c28075e3	EMAIL	Email	邮箱	email	t	t	t	f	\N	\N	\N	\N	\N	\N	\N	{}	2	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0931-7fe1-9635-26214cadb564	MOBILE	Mobile (OTP)	手机号	mobile	t	t	t	f	\N	\N	\N	\N	\N	\N	\N	{}	3	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0931-7b42-9c3a-ccf417fe6e24	IC_NO	IC Number	身份证号	ic	f	t	f	t	\N	\N	\N	\N	\N	\N	\N	{}	4	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0931-7485-a0d4-201de381d0a4	GOOGLE	Google	Google	oauth2	f	t	f	f	\N	\N	\N	\N	\N	\N	\N	{}	10	f	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0931-7d03-9907-79e0322d189d	FACEBOOK	Facebook	Facebook	oauth2	f	t	f	f	\N	\N	\N	\N	\N	\N	\N	{}	11	f	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0931-71d0-aba1-2bd1385b71cd	APPLE	Apple ID	Apple ID	oidc	f	t	f	f	\N	\N	\N	\N	\N	\N	\N	{}	12	f	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0931-77bc-9225-420d522abab4	MICROSOFT	Microsoft	微软账号	oidc	f	t	f	f	\N	\N	\N	\N	\N	\N	\N	{}	13	f	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0931-7349-8c67-6ccd689ca7be	WECHAT	WeChat	微信	oauth2	f	t	f	f	\N	\N	\N	\N	\N	\N	\N	{}	20	f	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0931-7585-abe9-0b5753783270	WHATSAPP	WhatsApp	WhatsApp	custom	f	t	f	f	\N	\N	\N	\N	\N	\N	\N	{}	21	f	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0931-7bd3-a010-109237aaf2ca	TELEGRAM	Telegram	Telegram	oauth2	f	t	f	f	\N	\N	\N	\N	\N	\N	\N	{}	22	f	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0931-75ec-bb76-8be6b1c349c1	LINE	LINE	LINE	oauth2	f	t	f	f	\N	\N	\N	\N	\N	\N	\N	{}	23	f	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
\.


--
-- Data for Name: languages; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.languages (id, code, label_en, native_label, is_active, is_default, sort_order, created_at) FROM stdin;
019ef9d3-0917-7e66-a9a2-29405fe6bd2d	en	English	English	t	t	1	2026-06-24 13:30:17.747579+00
019ef9d3-091b-7654-a400-64f858c2b139	zh-CN	Chinese Simplified	简体中文	t	f	2	2026-06-24 13:30:17.747579+00
019ef9d3-091b-7536-bdac-2dad499fda72	zh-TW	Chinese Traditional	繁體中文	t	f	3	2026-06-24 13:30:17.747579+00
019ef9d3-091b-7160-947c-e4773c6d1419	ms	Malay	Bahasa Melayu	t	f	4	2026-06-24 13:30:17.747579+00
019ef9d3-091c-709a-a85a-f82f44ca0cd1	ta	Tamil	தமிழ்	f	f	5	2026-06-24 13:30:17.747579+00
\.


--
-- Data for Name: marital_statuses; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.marital_statuses (id, code, label_en, label_zh, label_ms, sort_order, is_active) FROM stdin;
019ef9d3-0924-7bf2-99fd-69e88e8c2f64	SINGLE	Single	单身	Bujang	1	t
019ef9d3-0926-7c70-a78a-b7474ca8044e	MARRIED	Married	已婚	Berkahwin	2	t
019ef9d3-0926-71d0-ac01-dc18567d6bf7	DIVORCED	Divorced	离婚	Bercerai	3	t
019ef9d3-0926-77bd-a7f9-b783d7ef8b3a	WIDOWED	Widowed	丧偶	Balu/Duda	4	t
019ef9d3-0926-7768-acd1-7c801a70cf36	OTHER	Other	其他	Lain-lain	9	t
\.


--
-- Data for Name: occupations; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.occupations (id, code, label_en, label_zh, label_ms, sort_order, is_active) FROM stdin;
019ef9d3-0929-79a2-934d-33dc6b29edd7	EMPLOYEE	Employee	受薪员工	Pekerja	1	t
019ef9d3-092a-7221-964d-46c812ab723b	SELF_EMPLOYED	Self-Employed	自雇/生意人	Bekerja Sendiri	2	t
019ef9d3-092a-7a92-a181-414db43ad2eb	PROFESSIONAL	Professional	专业人士	Profesional	3	t
019ef9d3-092a-7527-b274-521fb40f1e3c	STUDENT	Student	学生	Pelajar	4	t
019ef9d3-092a-7ef6-bc32-9cec591d917a	HOUSEWIFE	Homemaker	家庭主妇	Surirumah	5	t
019ef9d3-092a-7aea-a2f9-12ebdf081c65	RETIRED	Retired	退休	Bersara	6	t
019ef9d3-092a-7a06-96a5-c62f499065bb	UNEMPLOYED	Unemployed	待业	Tidak Bekerja	7	t
019ef9d3-092a-7061-9b1d-5b4518caf378	OTHER	Other	其他	Lain-lain	9	t
\.


--
-- Data for Name: registration_policies; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.registration_policies (id, policy_key, is_enabled, description, metadata, updated_by, created_at, updated_at) FROM stdin;
019ef9d3-0935-7742-97f7-77a3f3999320	public_register	f	允许外部用户自助注册	{"default_status": "PENDING", "require_email_verify": true}	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0936-73d2-8851-f812b8e1195b	invite_register	f	允许通过邀请链接注册	{"expire_days": 7, "default_status": "ACTIVE", "max_uses_per_link": 1}	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0936-7b3d-8374-f3943669b736	oauth_register	f	允许通过第三方 OAuth 直接注册	{"require_email": false, "default_status": "ACTIVE"}	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0936-7957-a327-5333eec77d3a	require_real_name_verify	f	是否启用实名认证功能	{"method": "DOCUMENT", "required_for_login": false, "required_for_action": false}	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0936-724a-befe-2e3dcc0f4a39	require_email_verify	t	注册后是否必须验证邮箱	{"expire_minutes": 30}	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0936-7a53-9a46-2a99dd9aa12c	require_mobile_verify	f	注册后是否必须验证手机号	{"otp_length": 6, "expire_minutes": 5}	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0936-7d13-85c3-d56862f75232	admin_approval_required	f	自助注册是否需要管理员审批	{}	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
\.


--
-- Data for Name: religions; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.religions (id, code, label_en, label_zh, label_ms, sort_order, is_active) FROM stdin;
019ef9d3-091e-73ba-bec7-7e7c1522dc9c	ISLAM	Islam	伊斯兰教	Islam	1	t
019ef9d3-0920-7ada-a328-03945367e8c7	BUDDHISM	Buddhism	佛教	Buddha	2	t
019ef9d3-0920-7d87-ab6d-fba4434faae2	CHRISTIANITY	Christianity	基督教	Kristian	3	t
019ef9d3-0920-74c5-9aab-0a0edd5aaf7f	HINDUISM	Hinduism	印度教	Hindu	4	t
019ef9d3-0920-75c4-99f6-39abe153513f	TAOISM	Taoism	道教	Tao	5	t
019ef9d3-0920-7058-8b75-9bbd7ff8b992	SIKHISM	Sikhism	锡克教	Sikh	6	t
019ef9d3-0920-7d7b-886d-2829a297e8ec	OTHER	Other	其他	Lain-lain	8	t
019ef9d3-0920-709e-b42b-649dcb2b3936	NONE	None	无宗教信仰	Tiada	9	t
\.


--
-- Data for Name: security_policies; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.security_policies (id, policy_key, value, value_type, description, updated_by, created_at, updated_at) FROM stdin;
019ef9d3-0932-70b6-93b1-d3ca4b666d96	access_token_minutes	15	integer	JWT Access Token 有效期（分钟）	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0934-75f6-8ed0-3e216e2fa2c9	refresh_token_days	30	integer	Refresh Token 有效期（天）	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0934-7126-8239-625b569b3ae0	max_active_sessions	5	integer	同一账户最多同时在线会话数	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0934-7972-9674-962a58545410	failed_login_limit	5	integer	登录失败多少次后锁定账户	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0934-7384-9005-8082b34a8579	account_lock_minutes	30	integer	账户锁定时长（分钟）	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0934-7b04-875c-d7c138e45d42	password_min_length	8	integer	密码最短长度	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0934-7db9-bc08-fc2b86154770	password_require_uppercase	true	boolean	密码是否需要大写字母	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0934-705d-ace8-ec9e46ec3a92	password_require_number	true	boolean	密码是否需要数字	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0934-725d-bfb1-bf9b8fd95cfd	password_require_symbol	false	boolean	密码是否需要特殊符号	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0934-7d5c-a30c-c3c5a8504aa3	bcrypt_cost	12	integer	bcrypt 哈希强度（10-14）	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: config; Owner: -
--

COPY config.settings (id, key, value, value_type, description, is_public, updated_by, created_at, updated_at) FROM stdin;
019ef9d3-0947-7341-af85-1ff901219270	lifeverse.goal_categories	[{"code":"health","icon":"💪","label_en":"Health","label_zh":"健康运动"},\r\n      {"code":"career","icon":"💼","label_en":"Career","label_zh":"事业工作"},\r\n      {"code":"family","icon":"👨‍👩‍👧","label_en":"Family","label_zh":"家庭关系"},\r\n      {"code":"finance","icon":"💰","label_en":"Finance","label_zh":"财务储蓄"},\r\n      {"code":"personal","icon":"🌱","label_en":"Personal Growth","label_zh":"个人成长"},\r\n      {"code":"travel","icon":"✈️","label_en":"Travel","label_zh":"旅行探险"},\r\n      {"code":"learning","icon":"📚","label_en":"Learning","label_zh":"学习教育"},\r\n      {"code":"spiritual","icon":"🙏","label_en":"Spiritual","label_zh":"心灵成长"},\r\n      {"code":"social","icon":"👥","label_en":"Social","label_zh":"社交社群"},\r\n      {"code":"creative","icon":"🎨","label_en":"Creative","label_zh":"创意爱好"}]	json	LifeVerse 人生目标分类	t	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0949-775f-b565-d5ac9909a816	lifeverse.family_relations	[{"code":"father","icon":"👨","label_en":"Father","label_zh":"父亲"},\r\n      {"code":"mother","icon":"👩","label_en":"Mother","label_zh":"母亲"},\r\n      {"code":"spouse","icon":"💑","label_en":"Spouse","label_zh":"配偶"},\r\n      {"code":"child","icon":"👶","label_en":"Child","label_zh":"子女"},\r\n      {"code":"sibling","icon":"👫","label_en":"Sibling","label_zh":"兄弟姐妹"},\r\n      {"code":"grandfather","icon":"👴","label_en":"Grandfather","label_zh":"祖父/外公"},\r\n      {"code":"grandmother","icon":"👵","label_en":"Grandmother","label_zh":"祖母/外婆"},\r\n      {"code":"uncle","icon":"👨","label_en":"Uncle","label_zh":"叔/舅"},\r\n      {"code":"aunt","icon":"👩","label_en":"Aunt","label_zh":"姑/阿姨"},\r\n      {"code":"cousin","icon":"🧑","label_en":"Cousin","label_zh":"表/堂亲"},\r\n      {"code":"in_law","icon":"👨‍👩‍👦","label_en":"In-law","label_zh":"姻亲"},\r\n      {"code":"other","icon":"🧑","label_en":"Other","label_zh":"其他亲属"}]	json	LifeVerse 家族关系代码	t	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0949-7bc5-9f42-afc25b525eb0	lifeverse.community_categories	[{"code":"lifestyle","icon":"🌟","label_en":"Lifestyle","label_zh":"生活方式"},\r\n      {"code":"health","icon":"💪","label_en":"Health","label_zh":"健康运动"},\r\n      {"code":"family","icon":"👨‍👩‍👧","label_en":"Family","label_zh":"家庭育儿"},\r\n      {"code":"career","icon":"💼","label_en":"Career","label_zh":"事业商业"},\r\n      {"code":"learning","icon":"📚","label_en":"Learning","label_zh":"学习成长"},\r\n      {"code":"travel","icon":"✈️","label_en":"Travel","label_zh":"旅行"},\r\n      {"code":"food","icon":"🍜","label_en":"Food","label_zh":"美食烹饪"},\r\n      {"code":"culture","icon":"🎭","label_en":"Culture","label_zh":"文化传承"},\r\n      {"code":"tech","icon":"💻","label_en":"Technology","label_zh":"科技"},\r\n      {"code":"sports","icon":"⚽","label_en":"Sports","label_zh":"体育运动"},\r\n      {"code":"arts","icon":"🎨","label_en":"Arts","label_zh":"艺术创意"},\r\n      {"code":"spiritual","icon":"🙏","label_en":"Spiritual","label_zh":"心灵宗教"},\r\n      {"code":"local","icon":"📍","label_en":"Local Community","label_zh":"本地社区"},\r\n      {"code":"other","icon":"💬","label_en":"Other","label_zh":"其他"}]	json	LifeVerse 社群分类	t	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0949-7108-b2bb-021747dca83e	lifeverse.org_categories	[{"code":"association","icon":"🏛️","label_en":"Association / Club","label_zh":"协会/社团"},\r\n      {"code":"business","icon":"💼","label_en":"Business / Company","label_zh":"企业/公司"},\r\n      {"code":"education","icon":"🏫","label_en":"School / Education","label_zh":"学校/教育"},\r\n      {"code":"religious","icon":"🕌","label_en":"Religious / Spiritual","label_zh":"宗教/灵修"},\r\n      {"code":"ngo","icon":"🌍","label_en":"NGO / Charity","label_zh":"非政府组织"},\r\n      {"code":"sports","icon":"⚽","label_en":"Sports / Recreation","label_zh":"体育/康乐"},\r\n      {"code":"arts","icon":"🎭","label_en":"Arts / Culture","label_zh":"艺术/文化"},\r\n      {"code":"community","icon":"🏘️","label_en":"Community / Residents","label_zh":"社区/居民"},\r\n      {"code":"professional","icon":"👔","label_en":"Professional Body","label_zh":"专业团体"},\r\n      {"code":"startup","icon":"🚀","label_en":"Startup / Innovation","label_zh":"创业/创新"},\r\n      {"code":"other","icon":"💬","label_en":"Other","label_zh":"其他"}]	json	LifeVerse 组织分类	t	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0949-7262-9fde-dff8dfbf5a33	lifeverse.org_permission_templates	[{"code":"members.view","group":"members","name_en":"View members","name_zh":"查看会员"},\r\n      {"code":"members.manage","group":"members","name_en":"Manage members","name_zh":"管理会员"},\r\n      {"code":"members.approve","group":"members","name_en":"Approve applications","name_zh":"审批申请"},\r\n      {"code":"finance.view","group":"finance","name_en":"View finances","name_zh":"查看财务"},\r\n      {"code":"finance.manage","group":"finance","name_en":"Manage finances","name_zh":"管理财务"},\r\n      {"code":"announcements.view","group":"comms","name_en":"View announcements","name_zh":"查看公告"},\r\n      {"code":"announcements.manage","group":"comms","name_en":"Manage announcements","name_zh":"管理公告"},\r\n      {"code":"messages.send","group":"comms","name_en":"Send messages","name_zh":"发送消息"},\r\n      {"code":"meetings.view","group":"meetings","name_en":"View meetings","name_zh":"查看会议"},\r\n      {"code":"meetings.manage","group":"meetings","name_en":"Manage meetings","name_zh":"管理会议"},\r\n      {"code":"files.view","group":"files","name_en":"View files","name_zh":"查看文件"},\r\n      {"code":"files.manage","group":"files","name_en":"Manage files","name_zh":"管理文件"},\r\n      {"code":"events.view","group":"events","name_en":"View events","name_zh":"查看活动"},\r\n      {"code":"events.register","group":"events","name_en":"Register for events","name_zh":"报名活动"},\r\n      {"code":"events.manage","group":"events","name_en":"Manage events","name_zh":"管理活动"},\r\n      {"code":"projects.view","group":"projects","name_en":"View projects","name_zh":"查看项目"},\r\n      {"code":"projects.manage","group":"projects","name_en":"Manage projects","name_zh":"管理项目"},\r\n      {"code":"tasks.manage","group":"projects","name_en":"Manage tasks","name_zh":"管理任务"},\r\n      {"code":"settings.manage","group":"admin","name_en":"Manage org settings","name_zh":"管理组织设置"},\r\n      {"code":"roles.manage","group":"admin","name_en":"Manage roles & permissions","name_zh":"管理角色权限"}]	json	LifeVerse 组织权限代码模板	f	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-0949-7a28-b2a5-f2c85eec3b76	lifeverse.org_role_templates	[{"code":"OWNER","level":0,"is_system":true,"is_default":false,"name_en":"Owner","name_zh":"创办人","permissions":"all"},\r\n      {"code":"ADMIN","level":10,"is_system":true,"is_default":false,"name_en":"Administrator","name_zh":"管理员"},\r\n      {"code":"COMMITTEE","level":20,"is_system":false,"is_default":false,"name_en":"Committee","name_zh":"理事"},\r\n      {"code":"MEMBER","level":50,"is_system":true,"is_default":true,"name_en":"Member","name_zh":"会员"},\r\n      {"code":"GUEST","level":90,"is_system":true,"is_default":false,"name_en":"Guest","name_zh":"访客"}]	json	LifeVerse 组织角色模板	f	\N	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: rbac; Owner: -
--

COPY rbac.permissions (id, code, name_en, name_zh, description, group_code, group_name_en, group_name_zh, is_system, is_active, created_at, updated_at) FROM stdin;
019ef9d3-093a-7747-adac-2dfe60b03666	users.read	View Users	查看用户	\N	users	Users	用户管理	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-7932-9e5f-7e46543074c9	users.create	Create Users	创建用户	\N	users	Users	用户管理	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-7f4f-8308-e306786a461c	users.update	Update Users	修改用户	\N	users	Users	用户管理	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-729c-814f-61fd94a1137f	users.delete	Delete Users	删除用户	\N	users	Users	用户管理	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-7740-b999-a99327860a69	users.manage	Full User Management	完整用户管理	\N	users	Users	用户管理	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-72e9-b751-97e9422c74fb	rbac.read	View Roles	查看角色权限	\N	rbac	RBAC	角色权限	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-7307-8b0d-5b7529e04a67	rbac.manage	Manage Roles	管理角色权限	\N	rbac	RBAC	角色权限	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-7a75-a5ef-05dc65aa4e8e	rbac.assign	Assign Roles	分配用户角色	\N	rbac	RBAC	角色权限	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-7e6d-bfe2-2fb9c0a30524	verification.read	View Verifications	查看认证记录	\N	verif	Verification	实名认证	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-7271-ab89-dbd8fc897553	verification.review	Review Verifications	审核认证申请	\N	verif	Verification	实名认证	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-7f43-8dad-4d8fb6a1c41e	config.read	View System Config	查看系统配置	\N	config	Config	系统配置	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-7999-976b-876a8af20af4	config.manage	Manage System Config	管理系统配置	\N	config	Config	系统配置	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-77cd-9de3-5d1a357a6404	audit.read	View Audit Logs	查看审计日志	\N	audit	Audit	审计日志	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-7325-a174-31eaa62cb350	profile.read	View Own Profile	查看自己资料	\N	profile	Profile	个人资料	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-7966-8d18-7de6ec9c38c6	profile.update	Update Own Profile	修改自己资料	\N	profile	Profile	个人资料	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093c-740f-8bdf-2b2cf2caec86	invitations.manage	Manage Invitations	管理邀请链接	\N	users	Users	用户管理	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093d-7d61-b59f-25d2a920d123	i18n.manage	Manage Translations	管理翻译内容	\N	system	System	系统	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
019ef9d3-093d-7e39-a907-59c43799d2ee	orgs.verify	Verify Organizations	核实组织注册	\N	system	System	系统	t	t	2026-06-24 13:30:17.747579+00	2026-06-24 13:30:17.747579+00
\.


--
-- PostgreSQL database dump complete
--


