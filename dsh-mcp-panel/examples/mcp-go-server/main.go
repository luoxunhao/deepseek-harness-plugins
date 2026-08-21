// mcp-go-server —— 用 Go 写的演示 MCP 服务器，供 dsh-mcp-panel 测试。
//
// 工具集：
//   echo      回显文本（字符串参数）
//   add       两数相加（数字参数）
//   now       当前时间（无参数）
//   env       读取环境变量（验证面板 env 配置真的传进了子进程）
//
// 传输：stdio。构建后直接把 exe 路径填进面板 command 即可。
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type EchoArgs struct {
	Text string `json:"text" jsonschema:"要回显的文本"`
}

type AddArgs struct {
	A float64 `json:"a" jsonschema:"第一个数"`
	B float64 `json:"b" jsonschema:"第二个数"`
}

type EnvArgs struct {
	Name string `json:"name" jsonschema:"环境变量名"`
}

func main() {
	ctx := context.Background()
	server := mcp.NewServer(&mcp.Implementation{Name: "go-demo", Version: "0.1.0"}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "echo",
		Description: "Echo the given text back",
	}, func(ctx context.Context, req *mcp.CallToolRequest, args EchoArgs) (*mcp.CallToolResult, any, error) {
		return textResult(args.Text), nil, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "add",
		Description: "Add two numbers",
	}, func(ctx context.Context, req *mcp.CallToolRequest, args AddArgs) (*mcp.CallToolResult, any, error) {
		return textResult(fmt.Sprintf("%g", args.A+args.B)), nil, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "now",
		Description: "Return the current local time",
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		return textResult(time.Now().Format(time.RFC3339)), nil, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "env",
		Description: "Read an environment variable of this server process",
	}, func(ctx context.Context, req *mcp.CallToolRequest, args EnvArgs) (*mcp.CallToolResult, any, error) {
		value, ok := os.LookupEnv(args.Name)
		if !ok {
			return textResult(fmt.Sprintf("(unset) %s", args.Name)), nil, nil
		}
		return textResult(value), nil, nil
	})

	if err := server.Run(ctx, &mcp.StdioTransport{}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func textResult(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: text}},
	}
}
