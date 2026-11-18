class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.27.2"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.2/calmlens-0.27.2-darwin-arm64.tar.gz"
      sha256 "0ab056d0b57a9223cd510c688cd9c2d7639b5ff0f1500db317eb6a36304ef358"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.2/calmlens-0.27.2-darwin-x64.tar.gz"
      sha256 "7bba9b713760e55df53cf76aba2c23cd21aaeb422153584ad9e57b6f9b02348b"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.2/calmlens-0.27.2-linux-arm64.tar.gz"
      sha256 "eff3f8f0a9a23cd6172a3a2d4721a5816f95de1221fa2f50d96fd69e8127c46a"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.2/calmlens-0.27.2-linux-x64.tar.gz"
      sha256 "714c878579bf69b396f92aa8c00baf00762b85919deb10ff02a2d3e84c25a766"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
