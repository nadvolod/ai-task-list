# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - heading "AI Task List" [level=1] [ref=e4]
      - paragraph [ref=e5]: Sign in to your account
      - generic [ref=e6]:
        - generic [ref=e7]: Invalid email or password.
        - generic [ref=e8]:
          - generic [ref=e9]: Email
          - textbox "you@example.com" [ref=e10]: e2e-test@test.com
        - generic [ref=e11]:
          - generic [ref=e12]: Password
          - textbox "••••••••" [ref=e13]: testpass123
        - button "Sign in" [ref=e14]
      - paragraph [ref=e15]:
        - text: No account?
        - link "Sign up" [ref=e16] [cursor=pointer]:
          - /url: /auth/signup
  - button "Open Next.js Dev Tools" [ref=e22] [cursor=pointer]:
    - img [ref=e23]
  - alert [ref=e26]
```