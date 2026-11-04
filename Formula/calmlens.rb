class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.20.0"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.20.0/calmlens-0.20.0-darwin-arm64.tar.gz"
      sha256 "8bb1cd4c11ae7a10de91f2474f88428f5ffb7a547f0071c59e2189293b8ad022"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.20.0/calmlens-0.20.0-darwin-x64.tar.gz"
      sha256 "b8953b289e41fd03cfdcfe11beb9ca5ad196cbe03f54b1d50e70bb12d25cc141"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.20.0/calmlens-0.20.0-linux-arm64.tar.gz"
      sha256 "7c05b8576683de044e84e99893b925bdce711f43c3cec226c7befa79f5d1772b"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.20.0/calmlens-0.20.0-linux-x64.tar.gz"
      sha256 "60ca69049b3f85b5d9f3dab6f6281406238d3e121636a283161cbd58cdd6bb0d"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
