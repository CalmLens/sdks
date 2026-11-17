class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.27.1"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.1/calmlens-0.27.1-darwin-arm64.tar.gz"
      sha256 "20cd1815aa524569a335d8959bfa4abc84f53bdf6f95e366c2f241bb999a0252"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.1/calmlens-0.27.1-darwin-x64.tar.gz"
      sha256 "cc273b001accced5a87c9f50c24d9808f5c864911c90932f24bd5ca27357a94d"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.1/calmlens-0.27.1-linux-arm64.tar.gz"
      sha256 "8addd06600fa209fefd707c3dc3b1635e2da232f46780b4113a4fdb96d226fb0"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.1/calmlens-0.27.1-linux-x64.tar.gz"
      sha256 "c46985b1ee925236f8fad8e24fcfa3b9462686beda892466cff7152b716349bc"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
