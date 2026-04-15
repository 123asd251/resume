import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/resume/',
  title: "ZGH's Portfolio",
  themeConfig: {
    // 导航栏配置
    nav: [
      { text: '首页', link: '/' },
      { text: '项目经验', link: '/projects/enterprise/index' },
      { text: '技术深挖', link: '/tech/java-spi' },
      // { text: '关于我', link: '/about' }
    ],
    // 侧边栏配置
    sidebar: {
    '/projects/': [
      // {
      //   text: '🛸 核心开源/个人项目',
      //   collapsed: false, // 默认展开
      //   items: [
      //     { text: 'X-Hub 数据集成平台', link: '/projects/x-hub' },
      //     { text: 'ZenNote 插件化笔记', link: '/projects/zennote' }
      //   ]
      // },
      // {
      //   text: '🛠️ 实用工具类',
      //   collapsed: true, // 默认折叠，节省空间
      //   items: [
      //     { text: 'Tauri 剪切板助手', link: '/projects/tools-clipboard' },
      //     { text: 'Rust 串口调试工具', link: '/projects/tools-serial' }
      //   ]
      // },
      {
        text: '🌍 GIS 公司项目',
        collapsed: true,
        items: [
          { text: '国家遥感数据与应用服务平台', link: '/projects/enterprise/gfbs' },
          { text: '国家检察遥感应用服务平台', link: '/projects/enterprise/jcmp' },
          { text: 'TiTiler 矢量瓦片服务', link: '/projects/enterprise/titiler' },
          { text: '遥感制图平台', link: '/projects/enterprise/rsmp' }
         
        ]
      }
    ]
  },
    // socialLinks: [
    //   { icon: 'github', link: 'https://github.com/123asd251' }
    // ]
  }
})